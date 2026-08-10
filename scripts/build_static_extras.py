#!/usr/bin/env python3
"""Converte os conjuntos exclusivos do Atlas Brasil para Parquet intermediário.

IPS e histórias municipais ainda possuem geradores independentes. Este passo
normaliza suas saídas em ``data/parquet`` para que o publicador as copie ao
contrato estático do site. Os JSONs são entradas transitórias e não são publicados.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUTPUT = DATA / "parquet"


def _write(table: pa.Table, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".parquet.tmp")
    temporary.unlink(missing_ok=True)
    try:
        pq.write_table(
            table,
            temporary,
            compression="zstd",
            compression_level=19,
            use_dictionary=True,
            row_group_size=max(1, min(8192, table.num_rows or 1)),
        )
        os.replace(temporary, destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _read(name: str) -> dict:
    with (DATA / name).open("r", encoding="utf-8") as source:
        return json.load(source)


def _collection(name: str, key: str, output_name: str) -> None:
    payload = _read(name)
    collection = payload.pop(key)
    metadata_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    rows = [
        {
            "ibge_code": str(code),
            "payload_json": json.dumps(row, ensure_ascii=False, separators=(",", ":")),
            "metadata_json": metadata_json,
        }
        for code, row in sorted(collection.items())
    ]
    table = pa.Table.from_pylist(rows, schema=pa.schema([
        ("ibge_code", pa.string()),
        ("payload_json", pa.string()),
        ("metadata_json", pa.string()),
    ]))
    destination = OUTPUT / output_name
    _write(table, destination)
    print(f"[OK] {destination.relative_to(ROOT)}: {len(rows):,} linhas")


def _single_payload(name: str, output_name: str) -> None:
    payload = _read(name)
    table = pa.table({
        "payload_json": [json.dumps(payload, ensure_ascii=False, separators=(",", ":"))]
    })
    destination = OUTPUT / output_name
    _write(table, destination)
    print(f"[OK] {destination.relative_to(ROOT)}: 1 linha")


def main() -> None:
    _single_payload("census_sector_catalog.json", "sector_catalog.parquet")
    _single_payload("sources_catalog.json", "sources_catalog.parquet")
    _collection("stories_brazil_cities.json", "cities", "stories_brazil_cities.parquet")
    _single_payload("ips_brazil.json", "ips_brazil.parquet")
    for year in (2024, 2025, 2026):
        _collection(
            f"ips_brazil_cities_{year}.json",
            "cities",
            f"ips_brazil_cities_{year}.parquet",
        )


if __name__ == "__main__":
    main()
