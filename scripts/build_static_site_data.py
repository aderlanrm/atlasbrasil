#!/usr/bin/env python3
"""Prepara somente os Parquets consumidos pelo site estático.

O ETL completo mantém partições estaduais e temáticas adequadas para
processamento. O navegador, porém, deve baixar apenas o necessário para a
navegação atual. Este publicador:

* recompata os conjuntos tabulares com Zstandard nível 19;
* divide o GeoParquet de setores em um arquivo por município;
* cria malhas municipais e estaduais locais derivadas dos setores do IBGE;
* grava um manifesto Parquet para auditoria e descoberta dos artefatos.

Nenhum download é realizado por este script. Por padrão ele lê
``data/parquet`` e grava ``data/parquet/site``. ``--source`` permite preparar
uma publicação a partir de outro diretório de resultados do mesmo ETL.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import os
import shutil
from pathlib import Path
from typing import Iterable

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "data" / "parquet"
DEFAULT_OUTPUT = DEFAULT_SOURCE / "site"
ZSTD_LEVEL = 19

RUNTIME_TABLES = (
    "city_indicators_master.parquet",
    "health_brazil.parquet",
    "health_brazil_cities.parquet",
    "health_global.parquet",
    "hdi_global.parquet",
    "hdi_owid.parquet",
    "idhm_brazil.parquet",
    "security_brazil.parquet",
    "security_brazil_cities.parquet",
    "security_global.parquet",
    "territorial_indicator_rollups.parquet",
    "world_data.parquet",
    "sector_catalog.parquet",
    "sources_catalog.parquet",
    "stories_brazil_cities.parquet",
    "ips_brazil.parquet",
    "ips_brazil_cities_2024.parquet",
    "ips_brazil_cities_2025.parquet",
    "ips_brazil_cities_2026.parquet",
)


def _atomic_parquet(frame, destination: Path, *, geo: bool = False) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.unlink(missing_ok=True)
    try:
        if geo:
            frame.to_parquet(
                temporary,
                index=False,
                compression="zstd",
                compression_level=ZSTD_LEVEL,
                use_dictionary=False,
                geometry_encoding="WKB",
                schema_version="1.1.0",
                write_covering_bbox=False,
                row_group_size=max(1, min(2048, len(frame))),
            )
        else:
            import pyarrow as pa
            import pyarrow.parquet as pq

            table = frame if isinstance(frame, pa.Table) else pa.Table.from_pandas(frame, preserve_index=False)
            pq.write_table(
                table,
                temporary,
                compression="zstd",
                compression_level=ZSTD_LEVEL,
                use_dictionary=True,
                row_group_size=max(1, min(8192, table.num_rows or 1)),
            )
        os.replace(temporary, destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _copy_runtime_tables(source: Path, output: Path) -> list[dict[str, object]]:
    import pyarrow.parquet as pq

    manifest: list[dict[str, object]] = []
    for name in RUNTIME_TABLES:
        source_path = source / name
        destination = output / "atlas" / name
        table = pq.read_table(source_path)
        _atomic_parquet(table, destination)
        manifest.append(_manifest_row(destination, output, "atlas", table.num_rows))
        print(f"  [OK] {name}: {table.num_rows:,} linhas")
    return manifest


def _validate_sources(source: Path) -> None:
    missing_tables = [name for name in RUNTIME_TABLES if not (source / name).is_file()]
    sector_sources = list(_sector_sources(source))
    missing_ufs = sorted(
        set("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split())
        - {uf for uf, _ in sector_sources}
    )
    problems = []
    if missing_tables:
        problems.append("Parquets obrigatórios ausentes:\n  - " + "\n  - ".join(missing_tables))
    if missing_ufs:
        problems.append("Partições estaduais de setores ausentes: " + ", ".join(missing_ufs))
    if problems:
        raise RuntimeError(
            "Publicação cancelada antes de alterar a saída.\n"
            + "\n".join(problems)
            + "\nExecute as etapas anteriores do ETL e tente novamente."
        )


def _append_existing_atlas_tables(
    rows: list[dict[str, object]], output: Path
) -> None:
    """Inclui no manifesto Parquets próprios gerados diretamente em site/atlas."""
    import pyarrow.parquet as pq

    known = {str(row["path"]) for row in rows}
    for path in sorted((output / "atlas").glob("*.parquet")):
        relative = path.relative_to(output).as_posix()
        if relative in known:
            continue
        rows.append(
            _manifest_row(path, output, "atlas", pq.ParquetFile(path).metadata.num_rows)
        )


def _sector_sources(source: Path) -> Iterable[tuple[str, Path]]:
    root = source / "setores_census"
    for path in sorted(root.glob("uf=*/setores.parquet")):
        yield path.parent.name.removeprefix("uf=").upper(), path


def _normalize_geometry_precision(frame):
    import shapely

    result = frame.copy()
    result[result.geometry.name] = shapely.set_precision(result.geometry, 1e-6)
    return result


def _publish_sector_partitions(
    source: Path,
    output: Path,
    *,
    workers: int,
) -> list[dict[str, object]]:
    import geopandas as gpd

    manifest: list[dict[str, object]] = []
    state_frames = []
    found = False
    for uf, path in _sector_sources(source):
        found = True
        print(f"  [UF {uf}] lendo {path.name}")
        sectors = gpd.read_parquet(path)
        if sectors.crs is None:
            sectors = sectors.set_crs(4326)
        elif sectors.crs.to_epsg() != 4326:
            sectors = sectors.to_crs(4326)
        sectors["ibge_code"] = sectors["ibge_code"].astype("string").str.zfill(7)
        sectors = sectors.sort_values(["ibge_code", "sector_id"], kind="stable")

        municipality_geometries = sectors[["ibge_code", sectors.geometry.name]].dissolve(
            by="ibge_code", as_index=False
        )
        municipality_geometries["uf"] = uf
        municipality_geometries = _normalize_geometry_precision(municipality_geometries)
        municipality_path = output / "municipalities" / f"{uf}.parquet"
        _atomic_parquet(municipality_geometries, municipality_path, geo=True)
        manifest.append(
            _manifest_row(
                municipality_path,
                output,
                "municipalities",
                len(municipality_geometries),
                uf=uf,
            )
        )

        state_geometry = municipality_geometries[[municipality_geometries.geometry.name]].dissolve()
        state_geometry["uf"] = uf
        state_frames.append(state_geometry[["uf", state_geometry.geometry.name]])

        grouped = list(sectors.groupby("ibge_code", sort=True, observed=True))

        def write_municipality(item):
            ibge_code, municipality = item
            destination = output / "sectors" / uf / f"{ibge_code}.parquet"
            if not destination.exists() or destination.stat().st_size == 0:
                municipality = _normalize_geometry_precision(municipality)
                _atomic_parquet(municipality, destination, geo=True)
            return _manifest_row(
                destination,
                output,
                "sectors",
                len(municipality),
                uf=uf,
                ibge_code=str(ibge_code),
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(write_municipality, item) for item in grouped]
            for completed, future in enumerate(concurrent.futures.as_completed(futures), 1):
                manifest.append(future.result())
                if completed % 100 == 0:
                    print(f"    {completed:,}/{len(grouped):,} municípios prontos", flush=True)
        print(
            f"  [OK] {uf}: {len(sectors):,} setores, "
            f"{len(municipality_geometries):,} municípios"
        )

    if not found:
        print("  [SKIP] setores: nenhuma partição estadual encontrada")
        return manifest

    states = pd.concat(state_frames, ignore_index=True)
    states = gpd.GeoDataFrame(states, geometry=state_frames[0].geometry.name, crs=4326)
    states = _normalize_geometry_precision(states)
    states_path = output / "states.parquet"
    _atomic_parquet(states, states_path, geo=True)
    manifest.append(_manifest_row(states_path, output, "states", len(states)))
    return manifest


def _manifest_row(
    path: Path,
    root: Path,
    dataset: str,
    rows: int,
    *,
    uf: str | None = None,
    ibge_code: str | None = None,
) -> dict[str, object]:
    return {
        "dataset": dataset,
        "path": path.relative_to(root).as_posix(),
        "uf": uf,
        "ibge_code": ibge_code,
        "rows": int(rows),
        "bytes": int(path.stat().st_size),
        "compression": "zstd",
        "compression_level": ZSTD_LEVEL,
    }


def _write_manifest(rows: list[dict[str, object]], output: Path) -> None:
    manifest = pd.DataFrame(rows).sort_values(
        ["dataset", "uf", "ibge_code", "path"], na_position="last"
    )
    _atomic_parquet(manifest, output / "manifest.parquet")
    summary = manifest.groupby("dataset", dropna=False).agg(
        files=("path", "count"), rows=("rows", "sum"), bytes=("bytes", "sum")
    )
    print("\nResumo da publicação:")
    print(summary.to_string())


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--clean-output",
        action="store_true",
        help="Remove somente o diretório de saída validado antes de reconstruir.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=max(2, min(8, os.cpu_count() or 2)),
        help="Compactações municipais paralelas (padrão: até 8).",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if args.workers < 1:
        raise RuntimeError("--workers deve ser pelo menos 1")
    if output == source or source in output.parents and output.name != "site":
        raise RuntimeError(f"Diretório de saída inseguro: {output}")
    _validate_sources(source)
    if args.clean_output and output.exists():
        if output.name != "site":
            raise RuntimeError(f"Recusa remover diretório que não se chama site: {output}")
        shutil.rmtree(output)
    output.mkdir(parents=True, exist_ok=True)

    print(f"Origem: {source}")
    print(f"Publicação: {output}")
    rows = _copy_runtime_tables(source, output)
    _append_existing_atlas_tables(rows, output)
    rows.extend(_publish_sector_partitions(source, output, workers=args.workers))
    _write_manifest(rows, output)


if __name__ == "__main__":
    main()
