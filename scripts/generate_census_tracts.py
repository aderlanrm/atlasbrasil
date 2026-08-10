#!/usr/bin/env python3
"""
Gera a base setorial do Censo 2022 diretamente em Parquet.

Saídas:
  data/parquet/setores_census/uf=PE/setores.parquet
  data/parquet/censo_setor_indicadores/tema=demography/uf=PE/indicadores.parquet

O GeoPackage oficial fornece a geometria e a hierarquia territorial. Os CSVs
nacionais de agregados são lidos dentro dos ZIPs, divididos por UF e gravados
diretamente em Parquet. Não são criados GeoJSONs, CSVs ou ZIPs persistentes.

Por padrão é usado o perfil ``map`` do catálogo, que materializa os indicadores
exibidos pelo Atlas e preserva todas as colunas oficiais dos temas utilizados.
Use ``--profile all`` para preservar todos os mais de 3 mil códigos publicados
nos pacotes setoriais do IBGE.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Iterable, Iterator, Optional, Sequence

import pandas as pd


ROOT_DIR = Path(__file__).resolve().parents[1]
CATALOG_PATH = ROOT_DIR / "data" / "census_sector_catalog.json"
PARQUET_DIR = ROOT_DIR / "data" / "parquet"
SECTORS_DATASET_DIR = PARQUET_DIR / "setores_census"
INDICATORS_DATASET_DIR = PARQUET_DIR / "censo_setor_indicadores"

ALL_UFS = [
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
    "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
    "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]
UF_CODE_BY_ABBREVIATION = {
    "RO": "11", "AC": "12", "AM": "13", "RR": "14", "PA": "15", "AP": "16",
    "TO": "17", "MA": "21", "PI": "22", "CE": "23", "RN": "24", "PB": "25",
    "PE": "26", "AL": "27", "SE": "28", "BA": "29", "MG": "31", "ES": "32",
    "RJ": "33", "SP": "35", "PR": "41", "SC": "42", "RS": "43", "MS": "50",
    "MT": "51", "GO": "52", "DF": "53",
}

OFFICIAL_VARIABLE_RE = re.compile(r"^V\d+$", re.IGNORECASE)
SECTOR_KEY_ALIASES = (
    "CD_SETOR",
    "SETOR",
    "COD_SETOR_M22FINAL",
    "COD_SETOR",
    "CD_SETOR_M22",
    "CD_SETOR_2022",
)
TEXT_COLUMNS = {
    "CD_SETOR", "SITUACAO", "CD_SIT", "CD_TIPO", "CD_REGIAO", "NM_REGIAO",
    "CD_UF", "NM_UF", "CD_MUN", "NM_MUN", "CD_DIST", "NM_DIST", "CD_SUBDIST",
    "NM_SUBDIST", "CD_BAIRRO", "NM_BAIRRO", "CD_NU", "NM_NU", "CD_FCU",
    "NM_FCU", "CD_AGLOM", "NM_AGLOM", "CD_RGINT", "NM_RGINT", "CD_RGI",
    "NM_RGI", "CD_CONCURB", "NM_CONCURB",
}


def load_catalog(path: Path = CATALOG_PATH) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as source:
        catalog = json.load(source)
    required = {"schemaVersion", "geometryUrlTemplate", "profiles", "topics", "indicators"}
    missing = sorted(required - set(catalog))
    if missing:
        raise ValueError(f"Catálogo setorial incompleto: {', '.join(missing)}")
    return catalog


def _download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "AtlasBrasilETL/2.0"})
    with urllib.request.urlopen(request, timeout=300) as response:
        with destination.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)


def _first_column(columns: Iterable[str], candidates: Iterable[str]) -> Optional[str]:
    available = set(columns)
    return next((candidate for candidate in candidates if candidate in available), None)


def _normalized_codes(series: pd.Series, length: int) -> pd.Series:
    return (
        series.astype("string")
        .str.replace(r"\D", "", regex=True)
        .str.slice(0, length)
    )


def _optional_text(frame, candidates: Iterable[str]) -> pd.Series:
    result = pd.Series(pd.NA, index=frame.index, dtype="string")
    for column in candidates:
        if column not in frame.columns:
            continue
        values = frame[column].astype("string").str.strip()
        values = values.mask(
            values.str.lower().isin(["", ".", "nan", "none", "null", "<na>"])
        )
        result = result.fillna(values)
    return result


def _optional_number(
    frame,
    candidates: Iterable[str],
    *,
    integer: bool = False,
    positive_only: bool = False,
) -> pd.Series:
    dtype = "Int64" if integer else "Float64"
    result = pd.Series(pd.NA, index=frame.index, dtype=dtype)
    for column in candidates:
        if column not in frame.columns:
            continue
        values = pd.to_numeric(frame[column], errors="coerce")
        if positive_only:
            values = values.where(values > 0)
        if integer:
            values = values.round().astype("Int64")
        else:
            values = values.astype("Float64")
        result = result.fillna(values)
    return result


def _normalize_sector_frame(gdf, uf: str):
    """Normaliza a malha e garante uma única geometria por setor censitário.

    A malha oficial pode representar um mesmo setor em vários polígonos
    desconectados. Os atributos censitários pertencem ao setor inteiro e não a
    cada fragmento; por isso, manter uma linha por polígono multiplica
    população, domicílios e qualquer indicador associado. Os fragmentos são
    unidos aqui antes dos dados temáticos serem vinculados por ``CD_SETOR``.
    """
    import geopandas as gpd
    import shapely

    uf = uf.upper()
    if gdf.crs is None:
        raise ValueError(f"A malha de {uf} não informa CRS.")
    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)

    municipality_column = _first_column(
        gdf.columns,
        ["CD_MUN", "CD_MUNICIPIO", "CD_GEOCMU"],
    )
    sector_column = _first_column(
        gdf.columns,
        ["CD_SETOR", "CD_SETOR20", "CD_GEOCODI", "ID"],
    )
    if not sector_column:
        raise ValueError(
            f"Não foi possível identificar o setor nas colunas: {list(gdf.columns)}"
        )

    sector_codes = _normalized_codes(gdf[sector_column], 15)
    municipality_codes = (
        _normalized_codes(gdf[municipality_column], 7)
        if municipality_column
        else sector_codes.str.slice(0, 7)
    )

    normalized = gpd.GeoDataFrame(
        {
            "ibge_code": municipality_codes,
            "sector_id": sector_codes,
            "situacao": _optional_text(gdf, ["SITUACAO"]),
            "situacao_code": _optional_text(gdf, ["CD_SIT"]),
            "sector_type": _optional_text(gdf, ["CD_TIPO"]),
            "area_km2": _optional_number(gdf, ["AREA_KM2"]),
            "bairro_code": _optional_text(gdf, ["CD_BAIRRO", "CD_BAIR"]),
            "bairro": _optional_text(gdf, ["NM_BAIRRO", "NM_BAIR"]),
            "distrito_code": _optional_text(gdf, ["CD_DIST"]),
            "distrito": _optional_text(gdf, ["NM_DIST", "NM_DISTRI"]),
            "subdistrito_code": _optional_text(gdf, ["CD_SUBDIST"]),
            "subdistrito": _optional_text(gdf, ["NM_SUBDIST"]),
            "pop": _optional_number(
                gdf,
                ["V0001", "v0001", "POP", "POPULACAO"],
                integer=True,
            ),
            "domicilios": _optional_number(
                gdf,
                ["V0002", "v0002", "DOMICILIOS", "DOM"],
                integer=True,
            ),
            "domicilios_ocupados": _optional_number(
                gdf,
                ["V0007", "v0007"],
                integer=True,
            ),
            "media_moradores_domicilio": _optional_number(
                gdf,
                ["V0005", "v0005"],
            ),
        },
        geometry=gdf.geometry,
        crs=gdf.crs,
    )
    normalized = normalized[
        normalized["ibge_code"].str.len().eq(7)
        & normalized["sector_id"].str.len().eq(15)
        & normalized.geometry.notna()
        & ~normalized.geometry.is_empty
    ]
    duplicated = normalized["sector_id"].duplicated(keep=False)
    if duplicated.any():
        singletons = normalized.loc[~duplicated]
        dissolved_rows = []
        geometry_name = normalized.geometry.name
        for _, fragments in normalized.loc[duplicated].groupby(
            "sector_id",
            sort=False,
            observed=True,
        ):
            row = fragments.iloc[0].copy()
            geometry = shapely.union_all(fragments.geometry.to_numpy())
            if geometry is not None and not geometry.is_valid:
                geometry = shapely.make_valid(geometry)
            row[geometry_name] = geometry
            dissolved_rows.append(row)
        dissolved = gpd.GeoDataFrame(
            dissolved_rows,
            geometry=geometry_name,
            crs=normalized.crs,
        )
        normalized = gpd.GeoDataFrame(
            pd.concat([singletons, dissolved], ignore_index=True),
            geometry=geometry_name,
            crs=normalized.crs,
        )

    if normalized["sector_id"].duplicated().any():
        raise ValueError(f"A malha de {uf} ainda contém setores duplicados após a união.")
    return normalized.sort_values(["ibge_code", "sector_id"]).reset_index(drop=True)


def _zip_csv_member(archive: zipfile.ZipFile) -> zipfile.ZipInfo:
    members = [
        member
        for member in archive.infolist()
        if not member.is_dir() and member.filename.lower().endswith(".csv")
    ]
    if not members:
        raise ValueError("O pacote oficial não contém CSV.")
    return max(members, key=lambda member: member.file_size)


def _normalized_official_column_name(column: Any) -> str:
    """Remove BOM/espaços e uniformiza cabeçalhos sem alterar códigos Vxxxxx."""
    return (
        str(column)
        .replace("\ufeff", "")
        .replace("ï»¿", "")
        .strip()
        .upper()
    )


def _sector_key_column(frame: pd.DataFrame) -> str:
    """Localiza as variantes oficiais da chave de setor e valida seus valores."""
    for candidate in SECTOR_KEY_ALIASES:
        if candidate in frame.columns:
            return candidate

    inferred = []
    for column in frame.columns:
        if "SETOR" not in column:
            continue
        sample = frame[column].dropna().head(100)
        if sample.empty:
            continue
        normalized = _normalized_codes(sample, 15)
        if normalized.str.len().eq(15).fillna(False).mean() >= 0.9:
            inferred.append(column)

    if len(inferred) == 1:
        return inferred[0]
    visible_columns = ", ".join(map(str, frame.columns[:8]))
    raise ValueError(
        "não foi possível identificar a chave do setor censitário "
        f"(cabeçalhos iniciais: {visible_columns})"
    )


def _official_csv_format(
    archive: zipfile.ZipFile,
    member: zipfile.ZipInfo,
) -> tuple[str, str]:
    """Detecta codificação e separador usando somente o início do CSV oficial."""
    with archive.open(member) as source:
        sample = source.read(64 * 1024)
    try:
        decoded = sample.decode("utf-8-sig")
        encoding = "utf-8-sig"
    except UnicodeDecodeError:
        decoded = sample.decode("latin-1")
        encoding = "latin-1"

    header = decoded.splitlines()[0] if decoded else ""
    delimiter_counts = {
        delimiter: header.count(delimiter)
        for delimiter in (";", ",", "\t")
    }
    delimiter = max(delimiter_counts, key=delimiter_counts.get)
    if delimiter_counts[delimiter] == 0:
        raise ValueError(
            f"{member.filename} não possui um separador CSV reconhecível."
        )
    return encoding, delimiter


def _official_csv_chunks(
    archive_path: Path,
    chunk_size: int = 25_000,
) -> Iterator[pd.DataFrame]:
    """Lê o CSV diretamente do ZIP e normaliza os nomes dos códigos oficiais."""
    with zipfile.ZipFile(archive_path) as archive:
        member = _zip_csv_member(archive)
        encoding, delimiter = _official_csv_format(archive, member)
        with archive.open(member) as source:
            reader = pd.read_csv(
                source,
                sep=delimiter,
                encoding=encoding,
                dtype="string",
                chunksize=chunk_size,
                low_memory=False,
            )
            for chunk in reader:
                chunk.columns = [
                    _normalized_official_column_name(column)
                    for column in chunk.columns
                ]
                try:
                    sector_key = _sector_key_column(chunk)
                except ValueError as error:
                    raise ValueError(f"{member.filename}: {error}") from error
                if sector_key != "CD_SETOR":
                    chunk.rename(columns={sector_key: "CD_SETOR"}, inplace=True)
                chunk["CD_SETOR"] = _normalized_codes(chunk["CD_SETOR"], 15)
                valid_sector_keys = chunk["CD_SETOR"].str.len().eq(15).fillna(False)
                if not valid_sector_keys.all():
                    invalid_count = int((~valid_sector_keys).sum())
                    raise ValueError(
                        f"{member.filename} contém {invalid_count} chaves setoriais inválidas."
                    )
                yield chunk


def _coerce_theme_frame(frame: pd.DataFrame) -> pd.DataFrame:
    """Fixa tipos para que todos os row groups tenham o mesmo schema Arrow."""
    converted = frame.copy()
    for column in converted.columns:
        if OFFICIAL_VARIABLE_RE.fullmatch(column) or column == "AREA_KM2":
            converted[column] = pd.to_numeric(converted[column], errors="coerce").astype(
                "float64"
            )
        else:
            converted[column] = converted[column].astype("string")
    return converted


def _theme_partition_path(topic_id: str, uf: str) -> Path:
    return (
        INDICATORS_DATASET_DIR
        / f"tema={topic_id}"
        / f"uf={uf}"
        / "indicadores.parquet"
    )


def _write_topic_partitions(
    topic_id: str,
    archive_path: Path,
    target_ufs: Sequence[str],
    schema_version: str,
    chunk_size: int = 25_000,
) -> dict[str, int]:
    """Divide um pacote nacional em Parquets por UF sem materializá-lo inteiro."""
    import pyarrow as pa
    import pyarrow.parquet as pq

    target_ufs = [uf.upper() for uf in target_ufs]
    prefixes = {UF_CODE_BY_ABBREVIATION[uf]: uf for uf in target_ufs}
    writers: dict[str, pq.ParquetWriter] = {}
    temporary_paths: dict[str, Path] = {}
    counts = {uf: 0 for uf in target_ufs}

    try:
        try:
            for chunk in _official_csv_chunks(archive_path, chunk_size=chunk_size):
                uf_prefixes = chunk["CD_SETOR"].str.slice(0, 2)
                for prefix, uf in prefixes.items():
                    selected = chunk.loc[uf_prefixes.eq(prefix)]
                    if selected.empty:
                        continue
                    selected = _coerce_theme_frame(selected)
                    output_path = _theme_partition_path(topic_id, uf)
                    output_path.parent.mkdir(parents=True, exist_ok=True)
                    temporary_path = output_path.with_suffix(".parquet.tmp")
                    temporary_paths[uf] = temporary_path

                    table = pa.Table.from_pandas(selected, preserve_index=False)
                    if uf not in writers:
                        metadata = dict(table.schema.metadata or {})
                        metadata.update({
                            b"atlas_brasil:source": b"IBGE Censo Demografico 2022",
                            b"atlas_brasil:topic": topic_id.encode("utf-8"),
                            b"atlas_brasil:catalog_version": schema_version.encode("utf-8"),
                        })
                        table = table.replace_schema_metadata(metadata)
                        writers[uf] = pq.ParquetWriter(
                            temporary_path,
                            table.schema,
                            compression="zstd",
                            compression_level=19,
                            use_dictionary=True,
                        )
                    else:
                        table = table.cast(writers[uf].schema)
                    # Um row group por lote reduz metadados e melhora a
                    # compressão das milhares de colunas oficiais. Essas
                    # partições são lidas por UF inteira durante o ETL.
                    writers[uf].write_table(table, row_group_size=chunk_size)
                    counts[uf] += len(selected)
        finally:
            for writer in writers.values():
                writer.close()
    except Exception:
        for temporary_path in temporary_paths.values():
            temporary_path.unlink(missing_ok=True)
        raise

    for uf, temporary_path in temporary_paths.items():
        output_path = _theme_partition_path(topic_id, uf)
        os.replace(temporary_path, output_path)
    return counts


def _sum_official_columns(frame: pd.DataFrame, columns: Sequence[str]) -> pd.Series:
    available = [column.upper() for column in columns if column.upper() in frame.columns]
    if len(available) != len(columns):
        missing = sorted(set(column.upper() for column in columns) - set(available))
        raise KeyError(f"Códigos oficiais ausentes no pacote: {', '.join(missing)}")
    numeric = frame[available].apply(pd.to_numeric, errors="coerce")
    return numeric.sum(axis=1, min_count=1).astype("Float64")


def _materialize_topic_indicators(
    topic_id: str,
    frame: pd.DataFrame,
    catalog: dict[str, Any],
) -> pd.DataFrame:
    """Extrai somente colunas canônicas; o Parquet temático preserva as demais."""
    if "CD_SETOR" not in frame.columns:
        raise ValueError(f"O tema {topic_id} não contém CD_SETOR.")

    result = pd.DataFrame({
        "sector_id": _normalized_codes(frame["CD_SETOR"], 15),
    })
    if topic_id == "basic":
        geography = {
            "situacao": ["SITUACAO"],
            "situacao_code": ["CD_SIT"],
            "sector_type": ["CD_TIPO"],
            "area_km2": ["AREA_KM2"],
            "bairro_code": ["CD_BAIRRO"],
            "bairro": ["NM_BAIRRO"],
            "distrito_code": ["CD_DIST"],
            "distrito": ["NM_DIST"],
            "subdistrito_code": ["CD_SUBDIST"],
            "subdistrito": ["NM_SUBDIST"],
        }
        for target, candidates in geography.items():
            source = _first_column(frame.columns, candidates)
            if source:
                result[target] = frame[source]

    for indicator in catalog["indicators"]:
        if indicator.get("topic") != topic_id or indicator.get("kind") == "categorical":
            continue
        target = indicator["property"]
        derived = indicator.get("derived") or {}
        source_codes = indicator.get("sourceCodes") or []
        numerator_codes = indicator.get("numeratorCodes") or derived.get("numeratorCodes") or []
        denominator_codes = indicator.get("denominatorCodes") or []

        if derived.get("denominatorProperty"):
            numerator_codes = numerator_codes or [derived.get("numeratorCode")]
            result[f"__numerator_{target}"] = _sum_official_columns(
                frame,
                [code for code in numerator_codes if code],
            )
            continue

        if numerator_codes and denominator_codes:
            numerator = _sum_official_columns(frame, numerator_codes)
            denominator = _sum_official_columns(frame, denominator_codes)
            scale = float(indicator.get("scale", 1))
            result[target] = (numerator / denominator.where(denominator > 0) * scale).astype(
                "Float64"
            )
            continue

        if source_codes:
            source = _first_column(
                frame.columns,
                [code.upper() for code in source_codes],
            )
            if source:
                result[target] = pd.to_numeric(frame[source], errors="coerce").astype(
                    "Float64"
                )
    return result


def _merge_prefer_new(base: pd.DataFrame, new: pd.DataFrame) -> pd.DataFrame:
    merged = base.merge(new, how="left", on="sector_id", suffixes=("", "__new"))
    for column in [name for name in merged.columns if name.endswith("__new")]:
        target = column.removesuffix("__new")
        if target in merged.columns:
            merged[target] = merged[column].combine_first(merged[target])
        else:
            merged[target] = merged[column]
        merged.drop(columns=[column], inplace=True)
    return merged


def _apply_cross_topic_derivations(
    frame: pd.DataFrame,
    catalog: dict[str, Any],
) -> pd.DataFrame:
    for indicator in catalog["indicators"]:
        derived = indicator.get("derived")
        if not derived:
            continue
        target = indicator["property"]
        numerator_property = derived.get("numeratorProperty")
        denominator_property = derived.get("denominatorProperty")
        if numerator_property:
            numerator_source = frame.get(numerator_property)
        else:
            numerator_source = frame.get(f"__numerator_{target}")
        denominator_source = frame.get(denominator_property)
        if numerator_source is None or denominator_source is None:
            continue
        numerator = pd.to_numeric(numerator_source, errors="coerce")
        denominator = pd.to_numeric(denominator_source, errors="coerce")
        scale = float(derived.get("scale", 1))
        frame[target] = (numerator / denominator.where(denominator > 0) * scale).astype(
            "Float64"
        )

    temporary_columns = [
        column for column in frame.columns if column.startswith("__numerator_")
    ]
    if temporary_columns:
        frame = frame.drop(columns=temporary_columns)
    return frame


def _enrich_sector_frame(
    sectors,
    uf: str,
    topic_ids: Sequence[str],
    catalog: dict[str, Any],
):
    """Associa os códigos oficiais por CD_SETOR e calcula indicadores explícitos."""
    import geopandas as gpd

    geometry_name = sectors.geometry.name
    crs = sectors.crs
    merged = pd.DataFrame(sectors.drop(columns=[geometry_name]))
    merged[geometry_name] = list(sectors.geometry)

    for topic_id in topic_ids:
        partition_path = _theme_partition_path(topic_id, uf)
        if not partition_path.exists():
            continue
        theme = pd.read_parquet(partition_path)
        canonical = _materialize_topic_indicators(topic_id, theme, catalog)
        merged = _merge_prefer_new(merged, canonical)

    merged = _apply_cross_topic_derivations(merged, catalog)
    integer_columns = ["pop", "domicilios", "domicilios_ocupados"]
    for column in integer_columns:
        if column in merged:
            merged[column] = pd.to_numeric(merged[column], errors="coerce").round().astype(
                "Int64"
            )
    return gpd.GeoDataFrame(merged, geometry=geometry_name, crs=crs)


def _write_sector_geoparquet(sectors, uf: str) -> Path:
    partition_dir = SECTORS_DATASET_DIR / f"uf={uf}"
    partition_dir.mkdir(parents=True, exist_ok=True)
    output_path = partition_dir / "setores.parquet"
    temporary_output = output_path.with_suffix(".parquet.tmp")

    # Otimização de precisão e tipos de dados para redução massiva de disco
    sectors = sectors.copy()
    if hasattr(sectors, "geometry") and sectors.geometry is not None:
        try:
            import shapely
            sectors[sectors.geometry.name] = shapely.set_precision(sectors.geometry, 1e-6)
        except Exception:
            pass

    precision_columns = {
        "pib_est_populacao",
        "pib_est_domicilios",
        "pib_est_renda",
    }
    for col in sectors.select_dtypes(include=["float64"]).columns:
        if col not in precision_columns:
            sectors[col] = sectors[col].astype("float32")
    for col in sectors.select_dtypes(include=["int64"]).columns:
        sectors[col] = pd.to_numeric(sectors[col], errors="coerce").astype("Int32")

    try:
        sectors.to_parquet(
            temporary_output,
            index=False,
            compression="zstd",
            compression_level=19,
            use_dictionary=False,
            geometry_encoding="WKB",
            schema_version="1.1.0",
            # A API filtra pelo código municipal; nenhum consumidor usa o
            # covering bbox físico, que acrescentava quatro colunas por linha.
            write_covering_bbox=False,
            row_group_size=8192,
        )
        os.replace(temporary_output, output_path)
    except Exception:
        temporary_output.unlink(missing_ok=True)
        raise
    return output_path


def process_official_uf_sectors(
    uf: str,
    *,
    topic_ids: Sequence[str] = (),
    catalog: Optional[dict[str, Any]] = None,
    download_root: Optional[Path] = None,
) -> bool:
    uf = uf.upper()
    catalog = catalog or load_catalog()
    geometry_url = catalog["geometryUrlTemplate"].format(uf=uf)
    print(f"\n🌐 [IBGE Censo 2022] Processando setores de {uf}...")

    owns_temporary_root = download_root is None
    temporary_context = tempfile.TemporaryDirectory() if owns_temporary_root else None
    temporary_root = (
        Path(temporary_context.name) if temporary_context is not None else Path(download_root)
    )
    source_path = temporary_root / f"{uf}_setores_CD2022.gpkg"
    source_downloaded = False
    try:
        if not source_path.exists():
            print(f"  [FETCH] {geometry_url}")
            _download(geometry_url, source_path)
            source_downloaded = True

        import geopandas as gpd

        print(f"  [PARSE] Lendo {source_path.name}...")
        source = gpd.read_file(source_path)
        sectors = _normalize_sector_frame(source, uf)
        if sectors.empty:
            raise ValueError("A normalização não produziu nenhum setor válido.")
        sectors = _enrich_sector_frame(sectors, uf, topic_ids, catalog)
        output_path = _write_sector_geoparquet(sectors, uf)
        print(
            f"  ✅ {len(sectors):,} setores gravados em {output_path} "
            f"({output_path.stat().st_size / 1024 / 1024:.1f} MB)"
        )
        return True
    except ImportError as error:
        print(f"  ❌ Dependência geoespacial ausente: {error}")
        return False
    except Exception as error:
        print(f"  ❌ Falha ao processar {uf}: {error}")
        return False
    finally:
        if download_root is not None and source_downloaded:
            source_path.unlink(missing_ok=True)
        if temporary_context is not None:
            temporary_context.cleanup()


def _resolve_topics(
    catalog: dict[str, Any],
    profile: str,
    requested_topics: Optional[str],
) -> list[str]:
    if requested_topics:
        topic_ids = [
            value.strip()
            for value in requested_topics.split(",")
            if value.strip()
        ]
    else:
        topic_ids = list(catalog["profiles"][profile])
    invalid = sorted(set(topic_ids) - set(catalog["topics"]))
    if invalid:
        raise ValueError(f"Temas desconhecidos: {', '.join(invalid)}")
    return list(dict.fromkeys(topic_ids))


def _parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="ETL direto GeoParquet/Parquet dos setores do Censo 2022."
    )
    parser.add_argument(
        "ufs",
        nargs="*",
        help="Siglas das UFs. Sem argumento, processa todas.",
    )
    parser.add_argument(
        "--profile",
        choices=["basic", "map", "all"],
        default="map",
        help="Conjunto de temas: basic, map (padrão) ou all (>3 mil códigos).",
    )
    parser.add_argument(
        "--topics",
        help="Lista de IDs de temas separada por vírgula; substitui --profile.",
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=25_000,
        help="Linhas lidas por lote de cada CSV nacional.",
    )
    parser.add_argument(
        "--reuse-topics",
        action="store_true",
        help="Reutiliza Parquets temáticos existentes em vez de baixá-los novamente.",
    )
    parser.add_argument(
        "--skip-hierarchy",
        action="store_true",
        help="Não executa a reconciliação macro/micro e os rollups após as malhas.",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> None:
    args = _parse_args(list(argv) if argv is not None else sys.argv[1:])
    catalog = load_catalog()
    target_ufs = [value.upper() for value in args.ufs] or ALL_UFS
    invalid_ufs = sorted(set(target_ufs) - set(ALL_UFS))
    if invalid_ufs:
        raise SystemExit(f"UFs inválidas: {', '.join(invalid_ufs)}")
    if args.chunk_size <= 0:
        raise SystemExit("--chunk-size deve ser maior que zero.")

    try:
        topic_ids = _resolve_topics(catalog, args.profile, args.topics)
    except ValueError as error:
        raise SystemExit(str(error)) from error

    print("🚀 ETL direto para GeoParquet — Setores Censitários IBGE 2022")
    print(f"   UFs: {', '.join(target_ufs)}")
    print(f"   Temas: {', '.join(topic_ids)}")

    topic_failures = []
    with tempfile.TemporaryDirectory() as temporary_directory:
        download_root = Path(temporary_directory)

        for topic_id in topic_ids:
            existing = [
                _theme_partition_path(topic_id, uf).exists()
                for uf in target_ufs
            ]
            if args.reuse_topics and all(existing):
                print(f"\n♻️  [{topic_id}] Reutilizando partições existentes.")
                continue

            topic = catalog["topics"][topic_id]
            archive_name = urllib.parse.unquote(
                Path(urllib.parse.urlparse(topic["url"]).path).name
            )
            archive_path = download_root / archive_name
            try:
                print(f"\n📦 [{topic_id}] {topic['label']}")
                print(f"  [FETCH] {topic['url']}")
                _download(topic["url"], archive_path)
                counts = _write_topic_partitions(
                    topic_id,
                    archive_path,
                    target_ufs,
                    str(catalog["schemaVersion"]),
                    chunk_size=args.chunk_size,
                )
                total = sum(counts.values())
                print(
                    f"  ✅ {total:,} linhas gravadas diretamente em Parquet "
                    f"para {sum(value > 0 for value in counts.values())} UFs."
                )
            except Exception as error:
                topic_failures.append(topic_id)
                print(f"  ❌ Falha no tema {topic_id}: {error}")
            finally:
                archive_path.unlink(missing_ok=True)

        success_count = sum(
            process_official_uf_sectors(
                uf,
                topic_ids=topic_ids,
                catalog=catalog,
                download_root=download_root,
            )
            for uf in target_ufs
        )

    print(f"\n✅ Malhas concluídas: {success_count}/{len(target_ufs)} UFs.")
    if topic_failures:
        print(f"❌ Temas com falha: {', '.join(topic_failures)}")
    if success_count != len(target_ufs) or topic_failures:
        raise SystemExit(1)
    if not args.skip_hierarchy:
        print("\n🔄 Reconciliando indicadores em todos os níveis territoriais...")
        from build_territorial_hierarchy import build

        build(target_ufs)


if __name__ == "__main__":
    main()
