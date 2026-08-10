#!/usr/bin/env python3
"""Consolida a malha mundial e grava o GeoParquet final diretamente."""

from __future__ import annotations

import os
from pathlib import Path

import geopandas as gpd
import requests
import truststore
from pyproj import Geod
from requests.adapters import HTTPAdapter
from shapely.geometry import shape
from urllib3.util.retry import Retry


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "parquet" / "world_data.parquet"
GEO_URL = (
    "https://raw.githubusercontent.com/datasets/geo-countries/"
    "master/data/countries.geojson"
)
WORLD_BANK_INDICATORS = {
    "gdp": "NY.GDP.MKTP.CD",
    "pop": "SP.POP.TOTL",
}
WORLD_BANK_URL = (
    "https://api.worldbank.org/v2/country/all/indicator/{indicator}"
    "?format=json&per_page=400&mrnev=1"
)


def http_session() -> requests.Session:
    truststore.inject_into_ssl()
    retry = Retry(
        total=4,
        connect=4,
        read=4,
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )
    session = requests.Session()
    session.headers.update({"User-Agent": "AtlasBrasilETL/1.0"})
    session.mount("https://", HTTPAdapter(max_retries=retry))
    return session


def fetch_json(session: requests.Session, url: str):
    response = session.get(url, timeout=(30, 180))
    response.raise_for_status()
    try:
        return response.json()
    except requests.exceptions.JSONDecodeError as error:
        raise RuntimeError(f"Resposta não JSON recebida de {url}") from error


def fetch_world_bank_indicator(
    session: requests.Session, indicator: str
) -> dict[str, float]:
    payload = fetch_json(session, WORLD_BANK_URL.format(indicator=indicator))
    if not isinstance(payload, list) or len(payload) < 2 or not isinstance(payload[1], list):
        raise RuntimeError(
            f"Resposta inesperada do Banco Mundial para o indicador {indicator}: "
            f"{str(payload)[:300]}"
        )
    return {
        str(item["countryiso3code"]): float(item["value"])
        for item in payload[1]
        if isinstance(item, dict)
        and item.get("countryiso3code")
        and item.get("value") is not None
    }


def corrected_iso3(properties: dict) -> str:
    iso3 = (
        properties.get("ISO_A3")
        or properties.get("ISO3166-1-Alpha-3")
        or properties.get("id")
        or ""
    )
    if iso3 != "-99":
        return str(iso3)

    name = str(properties.get("ADMIN") or properties.get("name") or "").lower()
    corrections = {
        "france": "FRA",
        "norway": "NOR",
        "somaliland": "SOM",
        "kosovo": "UNK",
    }
    return next((code for fragment, code in corrections.items() if fragment in name), "")


def build_world_frame() -> gpd.GeoDataFrame:
    session = http_session()
    print("Baixando a malha mundial da fonte GeoJSON...")
    geo_data = fetch_json(session, GEO_URL)
    if not isinstance(geo_data, dict) or not isinstance(geo_data.get("features"), list):
        raise RuntimeError("A fonte GeoJSON mundial retornou uma estrutura inesperada.")

    indicators = {}
    for field, indicator in WORLD_BANK_INDICATORS.items():
        print(f"Baixando {indicator} do Banco Mundial (valor mais recente)...")
        indicators[field] = fetch_world_bank_indicator(session, indicator)

    geod = Geod(ellps="WGS84")

    rows = []
    for feature in geo_data.get("features", []):
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry")
        if not geometry:
            continue

        iso3 = corrected_iso3(properties)
        source_name = properties.get("ADMIN") or properties.get("name") or ""
        polygon = shape(geometry)
        area_m2, _ = geod.geometry_area_perimeter(polygon)
        rows.append({
            "feature_id": str(feature.get("id") or iso3),
            "ISO_A3": iso3,
            "ADMIN": source_name,
            "pop": int(indicators["pop"].get(iso3) or 0),
            "areaKm2": abs(float(area_m2)) / 1_000_000,
            "gdp": float(indicators["gdp"].get(iso3) or 0),
            "name_pt": source_name,
            "region": "",
            "geometry": polygon,
        })

    if not rows:
        raise RuntimeError("A consolidação não produziu nenhum país.")
    return gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")


def main() -> None:
    frame = build_world_frame()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = OUTPUT_PATH.with_suffix(".parquet.tmp")
    frame.to_parquet(
        temporary_path,
        index=False,
        compression="zstd",
        compression_level=19,
        use_dictionary=False,
        geometry_encoding="WKB",
        schema_version="1.1.0",
        write_covering_bbox=False,
        row_group_size=1024,
    )
    os.replace(temporary_path, OUTPUT_PATH)
    print(f"{len(frame)} países gravados diretamente em {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
