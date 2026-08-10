"""Orchestrator: rebuild the municipal health Parquet with real DATASUS values.

For each municipality, this script merges:
    * CNES LT  (leitos, leitos SUS, UTI)                    -> bedsPer1000 / susBedsPer1000 / icuBedsPer100k
    * CNES PF  (medicos, enfermeiros)                       -> doctorsPer1000 / nursesPer1000
    * SIM + SINASC (mortalidade infantil/materna, 3 anos)   -> infantMortality / maternalMortality
    * PNI legado (cobertura vacinal media, 2019)            -> vaccinationCoverage

Municípios sem dado real continuam com o proxy da UF, exatamente como antes.
Cada linha indica quais campos sao reais via `realFields`, e o campo
`coverage` resume o estado: "municipal" / "uf_proxy" / "partial".

Uso:
    python -m scripts.build_health_brazil_cities                    # padrao
    python -m scripts.build_health_brazil_cities --cnes-month 2024 1 --sim-end 2022 --pni-year 2019
    python -m scripts.build_health_brazil_cities --ufs GO SP        # subset para debug
"""

from __future__ import annotations

import argparse
import json
import sys
from copy import deepcopy
from pathlib import Path

ATLAS_ROOT = Path(__file__).resolve().parents[1]
if str(ATLAS_ROOT) not in sys.path:
    sys.path.insert(0, str(ATLAS_ROOT))

from scripts.datasus import UFS, six_to_seven_map

ROOT = Path(__file__).resolve().parents[1]
HEALTH_PARQUET_PATH = ROOT / "data" / "parquet" / "health_brazil_cities.parquet"
HEALTH_STATE_PARQUET_PATH = ROOT / "data" / "parquet" / "health_brazil.parquet"
MASTER_PARQUET_PATH = ROOT / "data" / "parquet" / "city_indicators_master.parquet"
HEALTH_FIELDS = [
    "bedsPer1000", "susBedsPer1000", "icuBedsPer100k",
    "doctorsPer1000", "nursesPer1000", "infantMortality",
    "maternalMortality", "vaccinationCoverage", "privateCoverage",
]
IBGE_MUNICIPALITIES_URL = (
    "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome"
)


def load_existing_cities():
    if HEALTH_PARQUET_PATH.exists():
        import polars as pl
        df = pl.read_parquet(HEALTH_PARQUET_PATH)
        cities = {}
        for row in df.iter_rows(named=True):
            if row.get("data_json"):
                cities[row["ibge_code"]] = json.loads(row["data_json"])
            else:
                info = {key: value for key, value in row.items() if key != "ibge_code"}
                info["ibgeCode"] = row["ibge_code"]
                cities[row["ibge_code"]] = info
        return {"cities": cities}
    return {"cities": {}}


def _master_population() -> dict[str, int]:
    population = {}
    if MASTER_PARQUET_PATH.exists():
        import polars as pl
        frame = pl.read_parquet(MASTER_PARQUET_PATH, columns=["ibge_code", "pop"])
        population = {
            str(row["ibge_code"]): int(row["pop"] or 0)
            for row in frame.iter_rows(named=True)
            if int(row["pop"] or 0) > 0
        }
    if population:
        return population

    # Uma instalação nova não depende do catálogo mestre já existir.
    from scripts.datasus.population import fetch_population_by_ibge

    return fetch_population_by_ibge()


def save_cities(payload, population_by_code=None):
    HEALTH_PARQUET_PATH.parent.mkdir(parents=True, exist_ok=True)
    import polars as pl
    population_by_code = population_by_code or _master_population()
    cities = payload.get("cities", {})
    records = []
    for code, info in cities.items():
        real_fields = list(info.get("realFields") or [])
        record = {
            "ibge_code": str(code),
            "name": info.get("name", ""),
            "uf": info.get("uf", ""),
            "population2022": int(population_by_code.get(str(code), 0)),
            "year": int(info.get("year") or 0),
            "proxy": bool(info.get("proxy", not real_fields)),
            "coverage": info.get("coverage", "no_data"),
            "realFields": real_fields,
            "source": info.get("source", ""),
        }
        for field in HEALTH_FIELDS:
            # Valores herdados da UF nas bases antigas não são republicados
            # como se fossem observações municipais.
            record[field] = info.get(field) if field in real_fields else None
        records.append(record)
    df = pl.DataFrame(
        records,
        schema={
            "ibge_code": pl.String,
            "name": pl.String,
            "uf": pl.String,
            "population2022": pl.Int64,
            "year": pl.Int64,
            "proxy": pl.Boolean,
            "coverage": pl.String,
            "realFields": pl.List(pl.String),
            "source": pl.String,
            **{field: pl.Float32 for field in HEALTH_FIELDS},
        },
        strict=False,
    )
    df.write_parquet(HEALTH_PARQUET_PATH, compression="zstd", compression_level=19)
    print(f"  [SAVED PARQUET] {HEALTH_PARQUET_PATH} ({HEALTH_PARQUET_PATH.stat().st_size / 1024:.1f} KB)")


def aggregate_regions(payload, population_by_code=None):
    """Agrega somente campos municipais reais para UF e Brasil."""
    import polars as pl

    population_by_code = population_by_code or _master_population()
    cities = payload.get("cities", {})
    records = []
    for territory_id in ["BRA", *sorted({row.get("uf") for row in cities.values() if row.get("uf")})]:
        selected = [
            (code, row)
            for code, row in cities.items()
            if territory_id == "BRA" or row.get("uf") == territory_id
        ]
        output = {
            "territory_id": territory_id,
            "territory_name": "Brasil" if territory_id == "BRA" else territory_id,
            "territory_type": "country" if territory_id == "BRA" else "state",
            "year": max((int(row.get("year") or 0) for _, row in selected), default=0),
        }
        for field in HEALTH_FIELDS:
            weighted = []
            for code, row in selected:
                if field not in set(row.get("realFields") or []):
                    continue
                value = row.get(field)
                population = population_by_code.get(str(code), 0)
                if value is not None and population > 0:
                    weighted.append((float(value), population))
            output[field] = (
                sum(value * weight for value, weight in weighted)
                / sum(weight for _, weight in weighted)
                if weighted else None
            )
            output[f"{field}CoverageCities"] = len(weighted)
        records.append(output)

    frame = pl.DataFrame(records, strict=False)
    temporary = HEALTH_STATE_PARQUET_PATH.with_suffix(".parquet.tmp")
    frame.write_parquet(temporary, compression="zstd", compression_level=19)
    temporary.replace(HEALTH_STATE_PARQUET_PATH)
    print(f"  [SAVED PARQUET] {HEALTH_STATE_PARQUET_PATH} ({len(records)} territórios)")


def ensure_official_city_catalog(payload, population_by_code):
    """Cria/completa o esqueleto sem depender de JSON ou Parquet anterior."""
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:
        pass
    import requests

    response = requests.get(
        IBGE_MUNICIPALITIES_URL,
        timeout=180,
        headers={"User-Agent": "AtlasBrasilETL/2.0 (+offline-parquet)"},
    )
    response.raise_for_status()
    cities = payload.setdefault("cities", {})
    for city in response.json():
        code = str(city["id"])
        immediate = city.get("regiao-imediata") or {}
        intermediate = immediate.get("regiao-intermediaria") or {}
        uf = (intermediate.get("UF") or {}).get("sigla")
        if not uf:
            micro = city.get("microrregiao") or {}
            meso = micro.get("mesorregiao") or {}
            uf = (meso.get("UF") or {}).get("sigla", "")
        row = cities.setdefault(code, {})
        row.update({
            "ibgeCode": code,
            "name": city["nome"],
            "uf": uf,
            "population2022": int(population_by_code.get(code, 0)),
        })
        row.setdefault("proxy", True)
        row.setdefault("coverage", "no_data")
        row.setdefault("realFields", [])
    return payload


def merge_into_city_row(row: dict, leitos: dict | None, prof: dict | None,
                       mort: dict | None, vacc: dict | None,
                       cnes_competence: str, sim_window: str) -> dict:
    """Return an updated copy of `row` with whatever real fields we have."""
    updated = deepcopy(row)
    real_fields = []
    sources = set()

    if leitos:
        updated["bedsPer1000"] = leitos["bedsPer1000"]
        updated["susBedsPer1000"] = leitos["susBedsPer1000"]
        updated["icuBedsPer100k"] = leitos["icuBedsPer100k"]
        real_fields += ["bedsPer1000", "susBedsPer1000", "icuBedsPer100k"]
        sources.add(f"CNES/LT {cnes_competence}")

    if prof:
        updated["doctorsPer1000"] = prof["doctorsPer1000"]
        updated["nursesPer1000"] = prof["nursesPer1000"]
        real_fields += ["doctorsPer1000", "nursesPer1000"]
        sources.add(f"CNES/PF {cnes_competence}")

    if mort:
        updated["infantMortality"] = mort["infantMortality"]
        updated["maternalMortality"] = mort["maternalMortality"]
        real_fields += ["infantMortality", "maternalMortality"]
        sources.add(f"SIM+SINASC media {sim_window}")

    if vacc:
        updated["vaccinationCoverage"] = vacc["vaccinationCoverage"]
        real_fields.append("vaccinationCoverage")
        sources.add(f"PNI legado {vacc['pniYear']}")

    all_fields = {
        "bedsPer1000", "susBedsPer1000", "icuBedsPer100k",
        "doctorsPer1000", "nursesPer1000",
        "infantMortality", "maternalMortality",
        "vaccinationCoverage",
    }
    has_any_real = bool(real_fields)
    for field in all_fields:
        if field not in real_fields:
            updated[field] = None
    updated["proxy"] = not has_any_real
    updated["realFields"] = real_fields
    if has_any_real:
        updated["coverage"] = "municipal" if all_fields.issubset(real_fields) else "partial"
        updated["source"] = " + ".join(sorted(sources))
    else:
        updated["coverage"] = "uf_proxy"
    return updated


def update_metadata(payload: dict, totals: dict, cnes_competence: str,
                    sim_window: str, pni_year: int) -> None:
    real_count = totals["real"]
    partial_count = totals["partial"]
    proxy_count = totals["proxy"]

    meta = payload.setdefault("metadata", {})
    meta["title"] = "Indicadores municipais de saude e capacidade hospitalar"
    meta["source"] = "CNES/SIM/SINASC/PNI + IBGE Sidra"
    meta["sourceUrl"] = "https://datasus.saude.gov.br/informacoes-de-saude-tabnet/"
    meta["provenance"] = "misto"
    meta["freshness"] = (
        f"CNES {cnes_competence}; mortalidade media movel {sim_window}; "
        f"PNI legado {pni_year}"
    )
    meta["quality"] = "Cobertura completa com sinalizacao de proxy"
    meta["municipalityCount"] = real_count + partial_count + proxy_count
    meta["realMunicipalityCount"] = real_count
    meta["partialMunicipalityCount"] = partial_count
    meta["proxyMunicipalityCount"] = proxy_count
    meta["methodology"] = (
        "Municípios com dados em todos os 5 grupos (leitos, profissionais, "
        "mortalidade, vacinacao) sao marcadas como coverage=municipal. "
        "Municípios com apenas parte dos grupos sao coverage=partial e mantem "
        "proxy UF nos campos restantes. Municípios sem nenhum grupo continuam "
        "coverage=uf_proxy."
    )
    meta["limitations"] = [
        "PNI legado vai ate 2019; SI-PNI nominal (2020+) ainda nao integrado.",
        "Mortalidade municipal usa media movel de 3 anos e exclui municípios com <30 nascidos vivos no periodo.",
        "Leitos UTI = TP_LEITO complementar (inclui UTI Adulto/Infantil/Neonatal e UCIs).",
        "Profissionais usam CNS_PROF para deduplicacao; um profissional com vinculo em multiplos municípios e contado em cada um.",
    ]
    meta["updatePolicy"] = (
        "Reexecutar scripts/build_health_brazil_cities.py periodicamente. "
        "Cada execução consulta diretamente os arquivos oficiais do FTP DATASUS."
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cnes-year", type=int, default=2024)
    parser.add_argument("--cnes-month", type=int, default=1)
    parser.add_argument("--sim-end", type=int, default=2022,
                        help="Ultimo ano da janela movel SIM/SINASC (inclui -1 e -2)")
    parser.add_argument("--pni-year", type=int, default=2019)
    parser.add_argument("--ufs", nargs="*", default=None,
                        help="Subset de UFs para teste rapido")
    parser.add_argument(
        "--aggregate-only",
        action="store_true",
        help="Migra o Parquet existente para colunas e refaz apenas UF/Brasil",
    )
    args = parser.parse_args()

    if args.aggregate_only:
        payload = load_existing_cities()
        if not payload.get("cities"):
            raise RuntimeError("health_brazil_cities.parquet não existe ou está vazio.")
        population = _master_population()
        save_cities(payload, population)
        aggregate_regions(payload, population)
        return 0

    from scripts.datasus.cnes_leitos import (
        compute_rates as compute_leitos_rates,
        fetch_cnes_leitos_aggregated,
    )
    from scripts.datasus.cnes_profissionais import (
        compute_rates as compute_prof_rates,
        fetch_cnes_profissionais_aggregated,
    )
    from scripts.datasus.pni import (
        aggregate_coverage_by_municipality,
        compute_rates as compute_pni_rates,
        fetch_pni_coverage,
    )
    from scripts.datasus.population import fetch_population_by_ibge
    from scripts.datasus.sim_sinasc import (
        compute_rates as compute_mortality_rates,
        fetch_mortality_3yr_avg,
    )

    target_ufs = args.ufs or UFS
    cnes_competence = f"{args.cnes_year}-{args.cnes_month:02d}"
    sim_window = f"{args.sim_end - 2}-{args.sim_end}"

    print(f"[1/5] Buscando populacao IBGE Sidra (Censo 2022)...", flush=True)
    population = fetch_population_by_ibge()
    six_seven = six_to_seven_map(population.keys())
    print(f"      municipios com populacao: {len(population):,}")

    print(f"[2/5] CNES LT {cnes_competence} para {len(target_ufs)} UFs...", flush=True)
    leitos = fetch_cnes_leitos_aggregated(
        args.cnes_year, args.cnes_month, target_ufs, progress=True,
    )
    leitos_rates = compute_leitos_rates(leitos, six_seven, population)
    print(f"      municipios com leitos: {len(leitos_rates):,}")

    print(f"[3/5] CNES PF {cnes_competence}...", flush=True)
    profissionais = fetch_cnes_profissionais_aggregated(
        args.cnes_year, args.cnes_month, target_ufs, progress=True,
    )
    prof_rates = compute_prof_rates(profissionais, six_seven, population)
    print(f"      municipios com profissionais: {len(prof_rates):,}")

    print(f"[4/5] SIM + SINASC janela {sim_window}...", flush=True)
    agg = fetch_mortality_3yr_avg(args.sim_end, target_ufs, progress=True)
    mortality_rates = compute_mortality_rates(agg, six_seven)
    print(f"      municipios com mortalidade publicavel: {len(mortality_rates):,}")

    print(f"[5/5] PNI legado {args.pni_year}...", flush=True)
    df = fetch_pni_coverage(args.pni_year, target_ufs)
    vaccination_rates = compute_pni_rates(
        aggregate_coverage_by_municipality(df), six_seven,
    )
    print(f"      municipios com cobertura PNI: {len(vaccination_rates):,}")

    print("Mesclando em health_brazil_cities.parquet...", flush=True)
    payload = load_existing_cities()
    ensure_official_city_catalog(payload, population)
    cities = payload.setdefault("cities", {})

    totals = {"real": 0, "partial": 0, "proxy": 0, "touched": 0}
    for code7, row in cities.items():
        in_scope = (not args.ufs) or row.get("uf") in args.ufs
        if in_scope:
            row = merge_into_city_row(
                row,
                leitos_rates.get(code7),
                prof_rates.get(code7),
                mortality_rates.get(code7),
                vaccination_rates.get(code7),
                cnes_competence,
                sim_window,
            )
            cities[code7] = row
            totals["touched"] += 1
        coverage = row.get("coverage")
        if coverage == "municipal" or coverage == "municipal_initial":
            totals["real"] += 1
        elif coverage == "partial":
            totals["partial"] += 1
        else:
            totals["proxy"] += 1

    update_metadata(payload, totals, cnes_competence, sim_window, args.pni_year)
    save_cities(payload, population)
    aggregate_regions(payload, population)

    print()
    print(f"OK: {totals['touched']:,} municípios processados")
    print(f"  municipal (todos 5 grupos):  {totals['real']:,}")
    print(f"  partial   (alguns grupos):   {totals['partial']:,}")
    print(f"  uf_proxy  (nenhum grupo):    {totals['proxy']:,}")


if __name__ == "__main__":
    sys.exit(main())
