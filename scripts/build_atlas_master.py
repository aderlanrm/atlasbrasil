#!/usr/bin/env python3
"""
build_atlas_master.py
---------------------
Script Python mestre ETL do Atlas Brasil.
Compila, normaliza e atualiza offline todos os 8 módulos de indicadores territoriais:
1. Demografia (População Censo 2022 IBGE)
2. Economia (PIB dos Municípios SIDRA 5938)
3. Desenvolvimento (IDHM / PNUD / IPEA)
4. Segurança Pública (IPEA Atlas da Violência / FBSP)
5. Saúde (DATASUS CNES / SIM / SINASC / PNI)
6. Educação (INEP / ENEM)
7. Representação Política (Tetos constitucionais e mandatos)
8. Malhas Geográficas (UFs, Municípios e Setores Censitários)
"""

import os
import sys
import json
from pathlib import Path
from typing import Any, Optional

import polars as pl
import requests

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
SCRIPTS_DIR = ROOT_DIR / "scripts"

IBGE_MUNICIPIOS_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome"
IBGE_POP_2022_URL = "https://apisidra.ibge.gov.br/values/t/4714/n6/all/v/93/p/2022"
IBGE_PIB_URL = "https://apisidra.ibge.gov.br/values/t/5938/n6/all/v/37/p/{year}"
IBGE_PIB_YEARS = range(2002, 2024)


def fetch_json(url):
    print(f"  [FETCH] {url}...")
    response = requests.get(
        url,
        timeout=180,
        headers={"User-Agent": "AtlasBrasilETL/2.0 (+offline-parquet)"},
    )
    response.raise_for_status()
    return response.json()


def load_parquet_cities(filename: str) -> dict[str, dict[str, Any]]:
    """Carrega Parquet municipal colunar ou o leiaute legado com data_json."""
    filepath = DATA_DIR / "parquet" / filename
    if not filepath.exists():
        return {}

    frame = pl.read_parquet(filepath)
    cities = {}
    for row in frame.iter_rows(named=True):
        code = str(row["ibge_code"])
        if row.get("data_json"):
            cities[code] = json.loads(row["data_json"])
        else:
            cities[code] = {
                key: value for key, value in row.items()
                if key != "ibge_code" and value is not None
            }
            cities[code].setdefault("ibgeCode", code)
    return cities


def parse_sidra_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text in {"-", "...", "X"}:
        return None
    try:
        return float(text.replace(".", "").replace(",", ".")) if "," in text else float(text)
    except (TypeError, ValueError):
        return None


def sidra_rows(payload: Any) -> list[dict[str, Any]]:
    return payload[1:] if isinstance(payload, list) and payload else []


def existing_master_cities() -> dict[str, dict[str, Any]]:
    return load_parquet_cities("city_indicators_master.parquet")


def latest_state_idhm() -> dict[str, dict[str, Any]]:
    """Carrega o IDHM mais recente das UFs para uso explícito como proxy municipal."""
    filepath = DATA_DIR / "parquet" / "idhm_brazil.parquet"
    if not filepath.exists():
        return {}
    frame = pl.read_parquet(filepath).filter(
        (pl.col("agregacao").str.to_uppercase() == "UF")
        & pl.col("idhm").is_not_null()
        & pl.col("codigo").is_not_null()
    ).sort("ano")
    result = {}
    for row in frame.iter_rows(named=True):
        state_id = str(int(float(row["codigo"]))).zfill(2)
        result[state_id] = {
            "idhm": float(row["idhm"]),
            "year": int(row["ano"]),
        }
    return result


def build_master_indicators():
    print("\n[START] Compilando os módulos de indicadores municipais do Atlas...")

    previous_cities = existing_master_cities()
    health_cities = load_parquet_cities("health_brazil_cities.parquet")
    security_cities = load_parquet_cities("security_brazil_cities.parquet")
    idhm_states = latest_state_idhm()

    master_catalog = {
        "metadata": {
            "version": "1.0.1",
            "source": "Atlas Brasil ETL",
            "modules": [
                "demographics", "economy", "idhm", "security",
                "health", "education", "politics", "census_tracts"
            ]
        },
        "cities": {}
    }

    try:
        municipalities = fetch_json(IBGE_MUNICIPIOS_URL)
        for city in municipalities:
            code = str(city["id"])
            microrregiao = city.get("microrregiao") or {}
            mesorregiao = microrregiao.get("mesorregiao") or {}
            uf_obj = mesorregiao.get("UF") or {}
            uf = uf_obj.get("sigla")

            if not uf:
                reg_imediata = city.get("regiao-imediata") or {}
                reg_intermed = reg_imediata.get("regiao-intermediaria") or {}
                uf = reg_intermed.get("UF", {}).get("sigla", "")

            city_info = {
                "pop": 0,
                "gdp": 0,
                "gdpHistory": {},
                "idhm": 0,
                "security": {},
                "health": {},
                "education": {},
                "politics": {},
                **previous_cities.get(code, {}),
            }
            city_info.update({
                "id": code,
                "nome": city["nome"],
                "uf": uf,
                "stateId": code[:2],
            })
            master_catalog["cities"][code] = city_info
        print(f"   OK {len(master_catalog['cities'])} municípios cadastrados.")
    except Exception as e:
        print(f"   AVISO: catálogo municipal online indisponível ({e}). Usando Parquet anterior.")
        master_catalog["cities"] = previous_cities

    if not master_catalog["cities"]:
        raise RuntimeError("Catálogo municipal vazio; o Parquet existente foi preservado.")

    print("\n2. [Demografia] Atualizando população municipal do Censo 2022...")
    try:
        for row in sidra_rows(fetch_json(IBGE_POP_2022_URL)):
            code = "".join(ch for ch in str(row.get("D1C", "")) if ch.isdigit())
            population = parse_sidra_number(row.get("V"))
            if code in master_catalog["cities"] and population is not None:
                master_catalog["cities"][code]["pop"] = int(population)
    except Exception as e:
        print(f"   AVISO: população não atualizada ({e}); mantendo valores existentes.")

    print("\n3. [Economia] Atualizando série histórica do PIB municipal...")
    try:
        for year in IBGE_PIB_YEARS:
            for row in sidra_rows(fetch_json(IBGE_PIB_URL.format(year=year))):
                if str(row.get("D2C", "")) != "37":
                    continue
                code = "".join(ch for ch in str(row.get("D1C", "")) if ch.isdigit())
                value_thousand_reais = parse_sidra_number(row.get("V"))
                city = master_catalog["cities"].get(code)
                if not city or value_thousand_reais is None:
                    continue
                city.setdefault("gdpHistory", {})[str(year)] = value_thousand_reais * 1000

        for city in master_catalog["cities"].values():
            history = city.get("gdpHistory", {})
            if history:
                latest_year = max(history, key=lambda item: int(item) if str(item).isdigit() else -1)
                city["gdp"] = history[latest_year]
                city["gdpYear"] = latest_year
    except Exception as e:
        print(f"   AVISO: PIB não atualizado ({e}); mantendo valores existentes.")

    print("\n4. [Saúde & Segurança] Mesclando bases consolidadas DATASUS e IPEA...")
    for code, city_info in master_catalog["cities"].items():
        if code in security_cities:
            city_info["security"] = security_cities[code]
        if code in health_cities:
            city_info["health"] = health_cities[code]
        state_idhm = idhm_states.get(str(city_info.get("stateId", "")).zfill(2))
        if state_idhm:
            city_info["idhm"] = state_idhm["idhm"]
            city_info["idhmYear"] = state_idhm["year"]
            city_info["idhmProxy"] = True
            city_info["idhmSourceLevel"] = "state"

    # Salvar diretamente em Parquet
    out_parquet = DATA_DIR / "parquet" / "city_indicators_master.parquet"
    out_parquet.parent.mkdir(parents=True, exist_ok=True)

    records = []
    for code, info in master_catalog["cities"].items():
        records.append({
            "ibge_code": str(code),
            "nome": info.get("nome", ""),
            "uf": info.get("uf", ""),
            "state_id": str(info.get("stateId", "")),
            "pop": int(info.get("pop", 0)),
            "gdp": float(info.get("gdp", 0.0)),
            "idhm": float(info.get("idhm", 0.0)),
            "idhm_year": int(info.get("idhmYear", 0)) or None,
            "idhm_proxy": bool(info.get("idhmProxy", False)),
            "data_json": json.dumps(info, ensure_ascii=False)
        })

    df = pl.DataFrame(
        records,
        schema={
            "ibge_code": pl.String,
            "nome": pl.String,
            "uf": pl.String,
            "state_id": pl.String,
            "pop": pl.Int32,
            "gdp": pl.Float32,
            "idhm": pl.Float32,
            "idhm_year": pl.Int32,
            "idhm_proxy": pl.Boolean,
            "data_json": pl.String,
        },
    )
    df.write_parquet(out_parquet, compression="zstd", compression_level=19)
    print(f"  [SAVED PARQUET] {out_parquet} ({out_parquet.stat().st_size / 1024:.1f} KB)")
    print("\n[OK] Compilação mestre concluída diretamente em Parquet.")


if __name__ == "__main__":
    build_master_indicators()
