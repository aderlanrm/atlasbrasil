#!/usr/bin/env python3
"""Reconcilia indicadores do setor censitário ao país em Parquet.

Este ETL é a etapa final depois dos extratores das fontes oficiais. Ele:

* garante uma única linha/geometria por ``sector_id``;
* aloca totais municipais/estaduais aos setores com conservação do total;
* replica taxas e índices do território pai como *proxy*, sem dividi-los;
* agrega os setores para bairro oficial, município, UF e Brasil usando a regra
  estatística declarada no catálogo;
* grava somente GeoParquet/Parquet finais, de forma atômica.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any, Iterable, Sequence

import geopandas as gpd
import numpy as np
import pandas as pd
import polars as pl
import shapely

from generate_census_tracts import (
    ALL_UFS,
    CATALOG_PATH,
    PARQUET_DIR,
    SECTORS_DATASET_DIR,
    _theme_partition_path,
    _write_sector_geoparquet,
    load_catalog,
)


ROLLUP_PATH = PARQUET_DIR / "territorial_indicator_rollups.parquet"
MASTER_PATH = PARQUET_DIR / "city_indicators_master.parquet"

HEALTH_FIELDS = {
    "bedsPer1000": 1_000,
    "susBedsPer1000": 1_000,
    "icuBedsPer100k": 100_000,
    "doctorsPer1000": 1_000,
    "nursesPer1000": 1_000,
    "infantMortality": 1_000,
    "maternalMortality": 100_000,
    "vaccinationCoverage": 100,
}
SECURITY_STATE_FIELDS = {
    "mviRate": 100_000,
    "vehicleTheftRate": 100_000,
    "femicideRate": 100_000,
    "domesticViolenceRate": 100_000,
}
UF_NAME = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas",
    "BA": "Bahia", "CE": "Ceará", "DF": "Distrito Federal",
    "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão",
    "MT": "Mato Grosso", "MS": "Mato Grosso do Sul", "MG": "Minas Gerais",
    "PA": "Pará", "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco",
    "PI": "Piauí", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte",
    "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima",
    "SC": "Santa Catarina", "SP": "São Paulo", "SE": "Sergipe",
    "TO": "Tocantins",
}


def _read_parquet(filename: str) -> pd.DataFrame:
    path = PARQUET_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"Parquet obrigatório ausente: {path}")
    return pd.read_parquet(path)


def _latest_state_idhm() -> tuple[dict[str, float], dict[str, int]]:
    frame = _read_parquet("idhm_brazil.parquet")
    selected = frame.loc[
        frame["agregacao"].astype("string").str.upper().eq("UF")
        & pd.to_numeric(frame["idhm"], errors="coerce").notna()
        & pd.to_numeric(frame["codigo"], errors="coerce").notna()
    ].copy()
    selected["state_id"] = (
        pd.to_numeric(selected["codigo"], errors="raise").astype(int).astype(str).str.zfill(2)
    )
    selected["ano"] = pd.to_numeric(selected["ano"], errors="raise").astype(int)
    selected = selected.sort_values("ano").drop_duplicates("state_id", keep="last")
    return (
        dict(zip(selected["state_id"], selected["idhm"].astype(float))),
        dict(zip(selected["state_id"], selected["ano"].astype(int))),
    )


def _macro_sources() -> dict[str, Any]:
    master = _read_parquet("city_indicators_master.parquet")
    master["ibge_code"] = master["ibge_code"].astype("string")
    health_city = _read_parquet("health_brazil_cities.parquet")
    health_state = _read_parquet("health_brazil.parquet")
    security_city = _read_parquet("security_brazil_cities.parquet")
    security_state = _read_parquet("security_brazil.parquet")
    for frame in (health_city, security_city):
        frame["ibge_code"] = frame["ibge_code"].astype("string")
    state_idhm, state_idhm_year = _latest_state_idhm()
    return {
        "master": master.set_index("ibge_code", drop=False),
        "health_city": health_city.set_index("ibge_code", drop=False),
        "health_state": health_state.loc[
            health_state["territory_type"].eq("state")
        ].set_index("territory_id", drop=False),
        "security_city": security_city.set_index("ibge_code", drop=False),
        "security_state": security_state.loc[
            security_state["territory_type"].eq("state")
        ].set_index("territory_id", drop=False),
        "idhm": state_idhm,
        "idhm_year": state_idhm_year,
    }


def _deduplicate_geometries(sectors: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, int]:
    """Une somente os setores fragmentados e conserva um único conjunto de atributos."""
    duplicated = sectors["sector_id"].astype("string").duplicated(keep=False)
    if not duplicated.any():
        return sectors.sort_values(["ibge_code", "sector_id"]).reset_index(drop=True), 0

    geometry_name = sectors.geometry.name
    singletons = sectors.loc[~duplicated]
    dissolved_rows = []
    for _, fragments in sectors.loc[duplicated].groupby("sector_id", sort=False):
        row = fragments.iloc[0].copy()
        geometry = shapely.union_all(fragments.geometry.to_numpy())
        if geometry is not None and not geometry.is_valid:
            geometry = shapely.make_valid(geometry)
        row[geometry_name] = geometry
        dissolved_rows.append(row)
    dissolved = gpd.GeoDataFrame(
        dissolved_rows,
        geometry=geometry_name,
        crs=sectors.crs,
    )
    result = gpd.GeoDataFrame(
        pd.concat([singletons, dissolved], ignore_index=True),
        geometry=geometry_name,
        crs=sectors.crs,
    ).sort_values(["ibge_code", "sector_id"]).reset_index(drop=True)
    if result["sector_id"].duplicated().any():
        raise ValueError("Ainda há códigos de setor duplicados depois da união geométrica.")
    return result, int(len(sectors) - len(result))


def _positive_weights(values: pd.Series, fallback: pd.Series) -> pd.Series:
    weights = pd.to_numeric(values, errors="coerce").fillna(0).clip(lower=0).astype(float)
    if float(weights.sum()) <= 0:
        weights = pd.to_numeric(fallback, errors="coerce").fillna(0).clip(lower=0).astype(float)
    if float(weights.sum()) <= 0:
        weights = pd.Series(1.0, index=values.index, dtype=float)
    return weights


def _allocate_totals(
    frame: pd.DataFrame,
    totals: dict[str, float],
    weights: pd.Series,
) -> pd.Series:
    """Aloca por município e corrige o resíduo no maior peso."""
    result = pd.Series(np.nan, index=frame.index, dtype="float64")
    for parent, indexes in frame.groupby("ibge_code", sort=False).groups.items():
        total = totals.get(str(parent))
        if total is None or not math.isfinite(float(total)):
            continue
        group_weights = _positive_weights(weights.loc[indexes], frame.loc[indexes, "pop"])
        allocated = float(total) * group_weights / float(group_weights.sum())
        residual = float(total) - float(allocated.sum())
        allocated.loc[group_weights.idxmax()] += residual
        result.loc[indexes] = allocated
    return result


def _allocate_state_total(
    frame: pd.DataFrame,
    total: float | None,
    weights: pd.Series,
) -> pd.Series:
    if total is None or not math.isfinite(float(total)):
        return pd.Series(np.nan, index=frame.index, dtype="float64")
    positive = _positive_weights(weights, frame["pop"])
    allocated = float(total) * positive / float(positive.sum())
    allocated.loc[positive.idxmax()] += float(total) - float(allocated.sum())
    return allocated


def _lookup_column(indexed: pd.DataFrame, codes: pd.Series, column: str) -> pd.Series:
    if column not in indexed.columns:
        return pd.Series(np.nan, index=codes.index, dtype="float64")
    mapping = indexed[column].to_dict()
    return pd.to_numeric(codes.map(mapping), errors="coerce")


def _enrich_macro_indicators(
    sectors: gpd.GeoDataFrame,
    uf: str,
    sources: dict[str, Any],
) -> gpd.GeoDataFrame:
    result = sectors.copy()
    result["ibge_code"] = result["ibge_code"].astype("string")
    codes = result["ibge_code"]
    population = pd.to_numeric(result["pop"], errors="coerce").fillna(0)
    households = pd.to_numeric(result.get("domicilios"), errors="coerce").fillna(0)
    occupied = pd.to_numeric(result.get("domicilios_ocupados"), errors="coerce").fillna(0)
    income = pd.to_numeric(result.get("renda_media_responsavel"), errors="coerce").fillna(0)

    master = sources["master"]
    gdp_totals = pd.to_numeric(master["gdp"], errors="coerce").to_dict()
    result["pib_est_populacao"] = _allocate_totals(result, gdp_totals, population)
    result["pib_est_domicilios"] = _allocate_totals(result, gdp_totals, households)
    result["pib_est_renda"] = _allocate_totals(
        result,
        gdp_totals,
        income * occupied,
    )
    result["pib_source_level"] = "municipality"

    health_city = sources["health_city"]
    health_state = sources["health_state"]
    for field in HEALTH_FIELDS:
        municipal = _lookup_column(health_city, codes, field)
        state_value = (
            float(health_state.at[uf, field])
            if uf in health_state.index and pd.notna(health_state.at[uf, field])
            else np.nan
        )
        result[field] = municipal.fillna(state_value).astype("float64")
        result[f"{field}_source_level"] = np.where(
            municipal.notna(), "municipality", np.where(pd.notna(state_value), "state", "missing")
        )
    health_year = _lookup_column(health_city, codes, "year")
    state_health_year = (
        int(health_state.at[uf, "year"])
        if uf in health_state.index and pd.notna(health_state.at[uf, "year"])
        else pd.NA
    )
    result["health_year"] = health_year.fillna(state_health_year).astype("Int64")

    security_city = sources["security_city"]
    homicide_rate = _lookup_column(security_city, codes, "homicideRate")
    homicide_totals = pd.to_numeric(
        security_city.get("estimatedHomicides"), errors="coerce"
    ).to_dict()
    result["homicideRate"] = homicide_rate
    result["homicidios_est_populacao"] = _allocate_totals(
        result,
        homicide_totals,
        population,
    )
    result["homicide_source_level"] = np.where(
        homicide_rate.notna(), "municipality", "missing"
    )
    result["homicide_year"] = _lookup_column(security_city, codes, "year").astype("Int64")

    security_state = sources["security_state"]
    if uf in security_state.index:
        state_row = security_state.loc[uf]
        for field in SECURITY_STATE_FIELDS:
            result[field] = (
                float(state_row[field]) if pd.notna(state_row.get(field)) else np.nan
            )
        result["mvi_est_populacao"] = _allocate_state_total(
            result,
            float(state_row["mvi"]) if pd.notna(state_row.get("mvi")) else None,
            population,
        )
        result["security_state_year"] = int(state_row["year"])
    else:
        for field in SECURITY_STATE_FIELDS:
            result[field] = np.nan
        result["mvi_est_populacao"] = np.nan
        result["security_state_year"] = pd.NA
    result["security_state_source_level"] = "state"

    state_id = str(codes.iloc[0])[:2]
    result["idhm_proxy_uf"] = sources["idhm"].get(state_id, np.nan)
    result["idhm_proxy_uf_year"] = sources["idhm_year"].get(state_id, pd.NA)
    result["idhm_source_level"] = "state_proxy"
    return result


def _sum_columns(frame: pd.DataFrame, columns: Iterable[str]) -> pd.Series:
    available = [column for column in columns if column in frame.columns]
    if not available:
        return pd.Series(np.nan, index=frame.index, dtype="float64")
    return frame[available].apply(pd.to_numeric, errors="coerce").sum(axis=1, min_count=1)


def _official_weights(
    uf: str,
    catalog: dict[str, Any],
    sector_ids: pd.Series,
) -> pd.DataFrame:
    """Lê denominadores oficiais somente para a agregação, sem duplicá-los no mapa."""
    support = pd.DataFrame({"sector_id": sector_ids.astype("string")})
    topics: dict[str, list[dict[str, Any]]] = {}
    for indicator in catalog["indicators"]:
        topic = indicator.get("topic")
        if topic and indicator.get("aggregationMethod") in {"weighted_average", "weighted_median"}:
            topics.setdefault(topic, []).append(indicator)

    for topic, indicators in topics.items():
        path = _theme_partition_path(topic, uf)
        if not path.exists():
            continue
        schema = set(pl.read_parquet_schema(path))
        requested = {"CD_SETOR"}
        for indicator in indicators:
            requested.update(indicator.get("denominatorCodes") or [])
            if indicator["id"] in {"renda_media_responsavel", "renda_mediana_responsavel"}:
                requested.update({"V06004", "V06005"})
        theme = pd.read_parquet(path, columns=sorted(requested & schema))
        theme["sector_id"] = theme["CD_SETOR"].astype("string")
        weights = pd.DataFrame({"sector_id": theme["sector_id"]})
        for indicator in indicators:
            prop = indicator["property"]
            denominator_codes = indicator.get("denominatorCodes") or []
            if denominator_codes:
                weights[f"__weight_{prop}"] = _sum_columns(theme, denominator_codes)
            elif indicator["id"] in {"renda_media_responsavel", "renda_mediana_responsavel"}:
                mean = pd.to_numeric(theme.get("V06004"), errors="coerce")
                total = pd.to_numeric(theme.get("V06005"), errors="coerce")
                weights[f"__weight_{prop}"] = total / mean.where(mean > 0)
        keep = [column for column in weights if column == "sector_id" or column.startswith("__weight_")]
        support = support.merge(weights[keep], on="sector_id", how="left")
    return support


def _weight_for_indicator(frame: pd.DataFrame, indicator: dict[str, Any]) -> pd.Series:
    prop = indicator["property"]
    explicit = f"__weight_{prop}"
    if explicit in frame:
        return pd.to_numeric(frame[explicit], errors="coerce")
    denominator = indicator.get("denominator")
    aliases = {
        "populacao": "pop",
        "domicilios": "domicilios",
        "domicilios_ocupados": "domicilios_ocupados",
        "area_km2": "area_km2",
    }
    column = aliases.get(denominator, denominator)
    if column in frame:
        return pd.to_numeric(frame[column], errors="coerce")
    return pd.to_numeric(frame.get("pop"), errors="coerce")


def _weighted_median(values: pd.Series, weights: pd.Series) -> float:
    valid = values.notna() & weights.notna() & weights.gt(0)
    if not valid.any():
        return np.nan
    ordered = pd.DataFrame({"value": values[valid], "weight": weights[valid]}).sort_values("value")
    threshold = float(ordered["weight"].sum()) / 2
    return float(ordered.loc[ordered["weight"].cumsum().ge(threshold), "value"].iloc[0])


def _rollup(
    frame: pd.DataFrame,
    catalog: dict[str, Any],
    *,
    level: str,
    group_columns: Sequence[str],
) -> pd.DataFrame:
    groups = frame.groupby(list(group_columns), dropna=False, sort=True, observed=True)
    base = groups.agg(
        sector_count=("sector_id", "nunique"),
        population_coverage=("pop", "sum"),
    ).reset_index()
    for indicator in catalog["indicators"]:
        prop = indicator.get("property")
        method = indicator.get("aggregationMethod", "none")
        if not prop or prop not in frame or method == "none" or indicator.get("kind") == "categorical":
            continue
        values = pd.to_numeric(frame[prop], errors="coerce")
        if method == "sum":
            aggregated = values.groupby(
                [frame[column] for column in group_columns], dropna=False, sort=True
            ).sum(min_count=1)
        elif method == "weighted_average":
            weights = _weight_for_indicator(frame, indicator)
            valid = values.notna() & weights.notna() & weights.gt(0)
            numerator = (values.where(valid) * weights.where(valid)).groupby(
                [frame[column] for column in group_columns], dropna=False, sort=True
            ).sum(min_count=1)
            denominator = weights.where(valid).groupby(
                [frame[column] for column in group_columns], dropna=False, sort=True
            ).sum(min_count=1)
            aggregated = numerator / denominator.where(denominator > 0)
        elif method == "weighted_median":
            weights = _weight_for_indicator(frame, indicator)
            temporary = frame[list(group_columns)].copy()
            temporary["__value"] = values
            temporary["__weight"] = weights
            aggregated = temporary.groupby(
                list(group_columns), dropna=False, sort=True, observed=True
            ).apply(
                lambda group: _weighted_median(group["__value"], group["__weight"]),
                include_groups=False,
            )
        else:
            continue
        values_frame = aggregated.rename(prop).reset_index()
        base = base.merge(values_frame, on=list(group_columns), how="left")
    base.insert(0, "level", level)
    base["methodology"] = "aggregated_from_unique_census_sectors"
    return base


def _build_rollups(
    frames: list[pd.DataFrame],
    catalog: dict[str, Any],
    sources: dict[str, Any],
) -> pd.DataFrame:
    sectors = pd.concat(frames, ignore_index=True)
    master_names = sources["master"]["nome"].to_dict()

    official_neighborhood = (
        sectors["bairro"].astype("string").str.strip().fillna("").ne("")
    )
    neighborhoods = sectors.loc[official_neighborhood].copy()
    neighborhoods["bairro_key"] = neighborhoods["bairro_code"].astype("string").fillna(
        neighborhoods["bairro"].astype("string").str.casefold()
    )
    neighborhood = _rollup(
        neighborhoods,
        catalog,
        level="neighborhood",
        group_columns=["uf", "ibge_code", "bairro_key"],
    )
    neighborhood["territory_id"] = (
        neighborhood["ibge_code"].astype(str) + ":" + neighborhood["bairro_key"].astype(str)
    )
    name_lookup = neighborhoods.drop_duplicates(["uf", "ibge_code", "bairro_key"]).set_index(
        ["uf", "ibge_code", "bairro_key"]
    )["bairro"]
    neighborhood["territory_name"] = [
        name_lookup.get((row.uf, row.ibge_code, row.bairro_key), row.bairro_key)
        for row in neighborhood.itertuples()
    ]
    neighborhood["parent_id"] = neighborhood["ibge_code"]

    municipality = _rollup(
        sectors,
        catalog,
        level="municipality",
        group_columns=["uf", "ibge_code"],
    )
    municipality["territory_id"] = municipality["ibge_code"].astype(str)
    municipality["territory_name"] = municipality["ibge_code"].map(master_names)
    municipality["parent_id"] = municipality["ibge_code"].astype(str).str[:2]

    state = _rollup(sectors, catalog, level="state", group_columns=["uf"])
    state["territory_id"] = state["uf"]
    state["territory_name"] = state["uf"].map(UF_NAME)
    state["parent_id"] = "BRA"
    state["ibge_code"] = pd.NA

    country_frame = sectors.assign(__country="BRA")
    country = _rollup(
        country_frame,
        catalog,
        level="country",
        group_columns=["__country"],
    ).drop(columns="__country")
    country["territory_id"] = "BRA"
    country["territory_name"] = "Brasil"
    country["parent_id"] = pd.NA
    country["uf"] = pd.NA
    country["ibge_code"] = pd.NA

    drop_helper = ["bairro_key"]
    result = pd.concat([neighborhood, municipality, state, country], ignore_index=True, sort=False)
    result.drop(columns=[column for column in drop_helper if column in result], inplace=True)
    leading = [
        "level", "territory_id", "territory_name", "parent_id", "uf", "ibge_code",
        "sector_count", "population_coverage", "methodology",
    ]
    return result[leading + [column for column in result if column not in leading]]


def _write_rollups(frame: pd.DataFrame) -> None:
    temporary = ROLLUP_PATH.with_suffix(".parquet.tmp")
    table = pl.from_pandas(frame)
    table.write_parquet(temporary, compression="zstd", compression_level=19)
    os.replace(temporary, ROLLUP_PATH)


def _update_master_idhm(sources: dict[str, Any]) -> None:
    frame = pl.read_parquet(MASTER_PATH).to_pandas()
    frame["state_id"] = frame["state_id"].astype("string").str.zfill(2)
    frame["idhm"] = frame["state_id"].map(sources["idhm"]).astype("float32")
    frame["idhm_year"] = frame["state_id"].map(sources["idhm_year"]).astype("Int32")
    frame["idhm_proxy"] = frame["idhm"].notna()
    if "data_json" in frame:
        payloads = []
        for row in frame.itertuples(index=False):
            payload = json.loads(row.data_json) if row.data_json else {}
            if pd.notna(row.idhm):
                payload.update({
                    "idhm": float(row.idhm),
                    "idhmYear": int(row.idhm_year),
                    "idhmProxy": True,
                    "idhmSourceLevel": "state",
                })
            payloads.append(json.dumps(payload, ensure_ascii=False, allow_nan=False))
        frame["data_json"] = payloads
    temporary = MASTER_PATH.with_suffix(".parquet.tmp")
    pl.from_pandas(frame).write_parquet(temporary, compression="zstd", compression_level=19)
    os.replace(temporary, MASTER_PATH)


def _validation(
    rollups: pd.DataFrame,
    sources: dict[str, Any],
    sector_frames: list[pd.DataFrame],
) -> None:
    sectors = pd.concat(sector_frames, ignore_index=True)
    if sectors["sector_id"].duplicated().any():
        raise RuntimeError("Validação falhou: ainda existem setores duplicados.")

    municipal = sectors.groupby("ibge_code", observed=True)["pop"].sum()
    expected = pd.to_numeric(sources["master"]["pop"], errors="coerce")
    comparable = expected.index.intersection(municipal.index)
    population_delta = (municipal.loc[comparable].astype(float) - expected.loc[comparable]).abs()
    if float(population_delta.max()) != 0:
        raise RuntimeError(
            f"Validação falhou: população municipal diverge em {int((population_delta > 0).sum())} municípios."
        )

    for field in ("pib_est_populacao", "pib_est_domicilios", "pib_est_renda"):
        allocated = sectors.groupby("ibge_code", observed=True)[field].sum(min_count=1)
        expected_gdp = pd.to_numeric(sources["master"]["gdp"], errors="coerce")
        common = allocated.dropna().index.intersection(expected_gdp.dropna().index)
        relative = (allocated.loc[common] - expected_gdp.loc[common]).abs() / expected_gdp.loc[common].abs().clip(lower=1)
        if float(relative.max()) > 1e-10:
            raise RuntimeError(f"Validação falhou: {field} não conserva o PIB municipal.")

    municipality_rollup = rollups.loc[rollups["level"].eq("municipality")].set_index("territory_id")
    common = municipality_rollup.index.intersection(expected.index)
    delta = (
        pd.to_numeric(municipality_rollup.loc[common, "pop"], errors="coerce")
        - expected.loc[common]
    ).abs()
    if float(delta.max()) != 0:
        raise RuntimeError("Validação falhou: rollup municipal não conserva a população.")


def build(target_ufs: Sequence[str]) -> None:
    catalog = load_catalog(CATALOG_PATH)
    sources = _macro_sources()
    removed_fragments = 0
    for uf in target_ufs:
        path = SECTORS_DATASET_DIR / f"uf={uf}" / "setores.parquet"
        if not path.exists():
            raise FileNotFoundError(f"GeoParquet setorial ausente: {path}")
        sectors = gpd.read_parquet(path)
        sectors, removed = _deduplicate_geometries(sectors)
        removed_fragments += removed
        sectors = _enrich_macro_indicators(sectors, uf, sources)
        _write_sector_geoparquet(sectors, uf)
        print(f"  OK {uf}: {len(sectors):,} setores únicos; {removed:,} fragmentos unidos")

    sector_frames: list[pd.DataFrame] = []
    for uf in ALL_UFS:
        path = SECTORS_DATASET_DIR / f"uf={uf}" / "setores.parquet"
        sectors = gpd.read_parquet(path)
        if sectors["sector_id"].duplicated().any():
            raise RuntimeError(
                f"{uf} ainda possui setores duplicados; processe todas as UFs antes da publicação."
            )
        geometry_name = sectors.geometry.name
        values = pd.DataFrame(sectors.drop(columns=[geometry_name, "bbox"], errors="ignore"))
        values["uf"] = uf
        support = _official_weights(uf, catalog, values["sector_id"])
        values = values.merge(support, on="sector_id", how="left")
        sector_frames.append(values)

    rollups = _build_rollups(sector_frames, catalog, sources)
    _validation(rollups, sources, sector_frames)
    _write_rollups(rollups)
    _update_master_idhm(sources)
    print(f"OK: {removed_fragments:,} fragmentos geométricos unidos")
    print(f"OK: {len(rollups):,} agregações territoriais -> {ROLLUP_PATH}")
    print("OK: população e três modelos de PIB reconciliados sem perda")


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ufs", nargs="*", help="UFs a reprocessar; vazio processa todas.")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(list(argv) if argv is not None else sys.argv[1:])
    target_ufs = [value.upper() for value in args.ufs] or ALL_UFS
    invalid = sorted(set(target_ufs) - set(ALL_UFS))
    if invalid:
        raise SystemExit(f"UFs inválidas: {', '.join(invalid)}")
    build(target_ufs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
