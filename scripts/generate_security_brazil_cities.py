#!/usr/bin/env python3
"""Gera o Parquet municipal de segurança diretamente do PDF oficial do Ipea.

A publicação municipal de 2024 contém a Tabela 2 em texto pesquisável. O PDF
é mantido apenas em memória; os códigos municipais são obtidos da API oficial
de Localidades do IBGE.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import re
import unicodedata
from pathlib import Path

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

import pandas as pd
import pdfplumber
import pyarrow as pa
import pyarrow.parquet as pq
import requests


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = ROOT / "data" / "parquet" / "security_brazil_cities.parquet"
SOURCE_URL = (
    "https://repositorio.ipea.gov.br/bitstream/11058/14031/5/"
    "AtlasViolencia2024_Retrato_dos_municipios_brasileros.pdf"
)
IBGE_MUNICIPALITIES_URL = (
    "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome"
)
ROW_PATTERN = re.compile(
    r"^(?P<rank>\d+)\s+(?P<name>.+?)\s+(?P<uf>[A-Z]{2})\s+"
    r"(?P<region>N|NE|CO|SE|S)\s+(?P<population>[\d.]+)\s+"
    r"(?P<registered>[\d.]+)\s+(?P<hidden>[\d.]+)\s+"
    r"(?P<estimated>[\d.]+)\s+(?P<rate>\d+(?:,\d+)?)$"
)


def _normalize(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", text).strip().casefold()


def _integer(value: str) -> int:
    return int(value.replace(".", ""))


def parse_table_rows(text: str) -> list[dict]:
    rows = []
    for line in text.splitlines():
        match = ROW_PATTERN.fullmatch(line.strip())
        if not match:
            continue
        values = match.groupdict()
        rows.append({
            "rank": int(values["rank"]),
            "name": values["name"],
            "uf": values["uf"],
            "region": values["region"],
            "population2022": _integer(values["population"]),
            "registeredHomicides": _integer(values["registered"]),
            "hiddenHomicides": _integer(values["hidden"]),
            "estimatedHomicides": _integer(values["estimated"]),
            "homicideRate": float(values["rate"].replace(",", ".")),
            "year": 2022,
        })
    return rows


def _municipality_codes(session: requests.Session) -> dict[tuple[str, str], str]:
    response = session.get(IBGE_MUNICIPALITIES_URL, timeout=180)
    response.raise_for_status()
    result = {}
    for city in response.json():
        immediate = city.get("regiao-imediata") or {}
        intermediate = immediate.get("regiao-intermediaria") or {}
        uf = (intermediate.get("UF") or {}).get("sigla")
        if not uf:
            micro = city.get("microrregiao") or {}
            meso = micro.get("mesorregiao") or {}
            uf = (meso.get("UF") or {}).get("sigla")
        result[(uf, _normalize(city["nome"]))] = str(city["id"])
    return result


def build(source_url: str = SOURCE_URL) -> tuple[pd.DataFrame, str]:
    session = requests.Session()
    session.headers.update({"User-Agent": "AtlasBrasilETL/2.0 (+offline-parquet)"})
    response = session.get(source_url, timeout=240)
    response.raise_for_status()
    content = response.content
    digest = hashlib.sha256(content).hexdigest()

    rows = []
    with pdfplumber.open(io.BytesIO(content)) as document:
        for page in document.pages:
            page_text = page.extract_text() or ""
            if "TABELA 2" in page_text and "homicídios estimados" in page_text:
                rows.extend(parse_table_rows(page_text))
    deduplicated = {row["rank"]: row for row in rows}
    if len(deduplicated) != 319:
        raise RuntimeError(
            f"A Tabela 2 deveria conter 319 municípios; foram extraídos {len(deduplicated)}. "
            "O PDF pode ter mudado de leiaute e o Parquet anterior foi preservado."
        )

    codes = _municipality_codes(session)
    missing = []
    for row in deduplicated.values():
        row["ibge_code"] = codes.get((row["uf"], _normalize(row["name"])))
        if not row["ibge_code"]:
            missing.append(f"{row['name']}/{row['uf']}")
    if missing:
        raise RuntimeError("Municípios sem código IBGE: " + ", ".join(missing))

    columns = [
        "ibge_code", "name", "uf", "region", "rank", "population2022",
        "registeredHomicides", "hiddenHomicides", "estimatedHomicides",
        "homicideRate", "year",
    ]
    frame = pd.DataFrame(deduplicated.values())[columns].sort_values("rank")
    return frame.reset_index(drop=True), digest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-url", default=SOURCE_URL)
    args = parser.parse_args()

    try:
        frame, digest = build(args.source_url)
    except Exception as exc:
        if OUTPUT_PATH.exists():
            print(f"AVISO: Não foi possível baixar do IPEA ({exc}). Re-encoding arquivo local existente...")
            frame = pd.read_parquet(OUTPUT_PATH)
            digest = "cached_existing"
        else:
            raise

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT_PATH.with_suffix(".parquet.tmp")

    for col in frame.select_dtypes(include=["float64"]).columns:
        frame[col] = frame[col].astype("float32")
    for col in frame.select_dtypes(include=["int64"]).columns:
        frame[col] = frame[col].astype("int32")

    table = pa.Table.from_pandas(frame, preserve_index=False)
    metadata = dict(table.schema.metadata or {})
    metadata.update({
        b"dataset": b"security_brazil_cities",
        b"source_url": args.source_url.encode(),
        b"source_sha256": digest.encode(),
        b"schema_version": b"2",
    })
    table = table.replace_schema_metadata(metadata)
    pq.write_table(
        table,
        temporary,
        compression="zstd",
        compression_level=19,
        use_dictionary=True,
    )
    temporary.replace(OUTPUT_PATH)
    print(f"OK: {len(frame)} municípios -> {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
