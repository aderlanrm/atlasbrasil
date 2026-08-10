#!/usr/bin/env python3
"""Atualiza os indicadores do Atlas diretamente das fontes para Parquet.

Os arquivos baixados existem somente em um diretório temporário. Nenhum CSV,
XLSX ou JSON intermediário é gravado em ``data``.

Uso:
    python src/atlas/scripts/generate_atlas_indicators.py --datasets all
    python src/atlas/scripts/generate_atlas_indicators.py --datasets hdi_global,health_global
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import re
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass

import openpyxl
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import requests


ROOT = Path(__file__).resolve().parents[1]
PARQUET_DIR = ROOT / "data" / "parquet"

UNDP_HDI_URL = (
    "https://hdr.undp.org/sites/default/files/2025_HDR/"
    "HDR25_Composite_indices_complete_time_series.csv"
)
OWID_HDI_URL = "https://ourworldindata.org/grapher/human-development-index.csv"
IDHM_URL = "https://www.undp.org/sites/g/files/zskgke326/files/2023-07/base_de_dados.xlsx"
WHO_API = "https://ghoapi.azureedge.net/api"
WORLD_BANK_API = "https://api.worldbank.org/v2"
FBSP_PAGE_URL = (
    "https://forumseguranca.org.br/publicacoes/"
    "anuario-brasileiro-de-seguranca-publica/?locale=pt_BR"
)

HEALTH_WB_INDICATORS = {
    "SH.MED.BEDS.ZS": ("hospitalBedsPer10000", 10.0),
    "SH.MED.PHYS.ZS": ("physiciansPer10000", 10.0),
    "SH.MED.NUMW.P3": ("nursesMidwivesPer10000", 10.0),
    "SH.XPD.CHEX.GD.ZS": ("healthExpPctGdp", 1.0),
    "SH.XPD.OOPC.CH.ZS": ("outOfPocketPct", 1.0),
}
HEALTH_WHO_INDICATORS = {
    "WHOSIS_000001": "lifeExpectancy",
    "WHOSIS_000002": "healthyLifeExpectancy",
    "UHC_INDEX_REPORTED": "uhcIndex",
}

UF_BY_NAME = {
    "acre": "AC", "alagoas": "AL", "amapa": "AP", "amazonas": "AM",
    "bahia": "BA", "ceara": "CE", "distrito federal": "DF",
    "espirito santo": "ES", "goias": "GO", "maranhao": "MA",
    "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG",
    "para": "PA", "paraiba": "PB", "parana": "PR", "pernambuco": "PE",
    "piaui": "PI", "rio de janeiro": "RJ", "rio grande do norte": "RN",
    "rio grande do sul": "RS", "rondonia": "RO", "roraima": "RR",
    "santa catarina": "SC", "sao paulo": "SP", "sergipe": "SE",
    "tocantins": "TO",
}


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _download(url: str, *, timeout: int = 180) -> tuple[bytes, str]:
    response = requests.get(
        url,
        timeout=timeout,
        headers={"User-Agent": "AtlasBrasilETL/2.0 (+offline-parquet)"},
    )
    response.raise_for_status()
    return response.content, hashlib.sha256(response.content).hexdigest()


def _write_parquet(
    frame: pd.DataFrame,
    filename: str,
    *,
    source_url: str,
    sha256: str,
    dataset: str,
) -> Path:
    if frame.empty:
        raise RuntimeError(f"A fonte de {dataset} retornou zero linhas; arquivo anterior preservado.")
    PARQUET_DIR.mkdir(parents=True, exist_ok=True)
    destination = PARQUET_DIR / filename
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    for col in frame.select_dtypes(include=["float64"]).columns:
        frame[col] = frame[col].astype("float32")
    for col in frame.select_dtypes(include=["int64"]).columns:
        frame[col] = frame[col].astype("int32")

    table = pa.Table.from_pandas(frame, preserve_index=False)
    metadata = dict(table.schema.metadata or {})
    metadata.update({
        b"dataset": dataset.encode(),
        b"source_url": source_url.encode(),
        b"source_sha256": sha256.encode(),
        b"generated_at": _now().encode(),
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
    temporary.replace(destination)
    print(f"  OK {dataset}: {len(frame):,} linhas -> {destination}")
    return destination


def _normalized_column(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return text or "column"


def _reshape_undp(source: pd.DataFrame) -> pd.DataFrame:
    static = [column for column in ("iso3", "country", "hdicode", "region") if column in source]
    by_year: dict[int, dict[str, str]] = {}
    for column in source.columns:
        match = re.fullmatch(r"(.+)_(19\d{2}|20\d{2})", str(column))
        if match:
            by_year.setdefault(int(match.group(2)), {})[column] = match.group(1)

    annual = []
    for year, columns in sorted(by_year.items()):
        part = source[static + list(columns)].rename(columns=columns).copy()
        part.insert(len(static), "year", year)
        annual.append(part)
    if not annual:
        raise ValueError("O CSV do PNUD não contém colunas no padrão indicador_ano.")

    result = pd.concat(annual, ignore_index=True, sort=False)
    result = result[result["iso3"].fillna("").astype(str).str.strip().ne("")]
    is_country = result["iso3"].astype(str).str.fullmatch(r"[A-Z]{3}")
    result["territory_type"] = is_country.map({True: "country", False: "aggregate"})
    return result.reset_index(drop=True)


def generate_hdi_global() -> Path:
    content, digest = _download(UNDP_HDI_URL)
    # O HDR distribui algumas edições em Windows-1252 apesar de o cabeçalho
    # HTTP nem sempre informar charset.
    try:
        source = pd.read_csv(io.BytesIO(content), low_memory=False, encoding="utf-8")
    except UnicodeDecodeError:
        source = pd.read_csv(io.BytesIO(content), low_memory=False, encoding="cp1252")
    return _write_parquet(
        _reshape_undp(source),
        "hdi_global.parquet",
        source_url=UNDP_HDI_URL,
        sha256=digest,
        dataset="hdi_global",
    )


def generate_hdi_owid() -> Path:
    content, digest = _download(OWID_HDI_URL)
    source = pd.read_csv(io.BytesIO(content))
    value_column = next(
        column for column in source.columns if column not in {"Entity", "Code", "Year"}
    )
    result = source.rename(columns={
        "Entity": "country", "Code": "iso3", "Year": "year", value_column: "hdi",
    })
    result = result[result["iso3"].fillna("").astype(str).str.fullmatch(r"[A-Z]{3}")]
    result["territory_type"] = "country"
    return _write_parquet(
        result.reset_index(drop=True),
        "hdi_owid.parquet",
        source_url=OWID_HDI_URL,
        sha256=digest,
        dataset="hdi_owid",
    )


def generate_idhm_brazil() -> Path:
    content, digest = _download(IDHM_URL)
    workbook = pd.read_excel(io.BytesIO(content), sheet_name=None)
    frames = []
    for sheet, frame in workbook.items():
        frame = frame.copy()
        frame.columns = [_normalized_column(column) for column in frame.columns]
        frame.insert(0, "sheet", sheet)
        frames.append(frame)
    result = pd.concat(frames, ignore_index=True, sort=False)
    return _write_parquet(
        result,
        "idhm_brazil.parquet",
        source_url=IDHM_URL,
        sha256=digest,
        dataset="idhm_brazil",
    )


def _odata_rows(url: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    while url:
        response = requests.get(
            url,
            timeout=180,
            headers={"User-Agent": "AtlasBrasilETL/2.0 (+offline-parquet)"},
        )
        response.raise_for_status()
        payload = response.json()
        rows.extend(payload.get("value", []))
        url = payload.get("@odata.nextLink")
    return rows


def _world_bank_rows(indicator: str, field: str, multiplier: float = 1.0) -> pd.DataFrame:
    url = (
        f"{WORLD_BANK_API}/country/all/indicator/{indicator}"
        "?format=json&per_page=20000"
    )
    response = requests.get(
        url,
        timeout=180,
        headers={"User-Agent": "AtlasBrasilETL/2.0 (+offline-parquet)"},
    )
    response.raise_for_status()
    payload = response.json()
    records = []
    for row in payload[1] or []:
        iso3 = str(row.get("countryiso3code") or "")
        value = row.get("value")
        if not re.fullmatch(r"[A-Z]{3}", iso3) or value is None:
            continue
        records.append({
            "iso3": iso3,
            "country": row.get("country", {}).get("value"),
            "year": int(row["date"]),
            field: float(value) * multiplier,
        })
    return pd.DataFrame(records)


def _merge_indicator_frames(frames: list[pd.DataFrame]) -> pd.DataFrame:
    result: pd.DataFrame | None = None
    for frame in frames:
        if frame.empty:
            continue
        if result is None:
            result = frame
        else:
            result = result.merge(frame, on=["iso3", "year"], how="outer", suffixes=("", "_new"))
            if "country_new" in result:
                result["country"] = result["country"].fillna(result.pop("country_new"))
    if result is None:
        return pd.DataFrame()
    result["territory_type"] = "country"
    return result.sort_values(["iso3", "year"]).reset_index(drop=True)


def generate_health_global() -> Path:
    frames = []
    source_hashes = []
    for code, field in HEALTH_WHO_INDICATORS.items():
        url = f"{WHO_API}/{code}?$filter=SpatialDimType%20eq%20%27COUNTRY%27"
        rows = _odata_rows(url)
        source_hashes.append(hashlib.sha256(repr(rows).encode()).hexdigest())
        records = []
        for row in rows:
            # WHO usa SEX_BTSX para ambos os sexos; UHC não possui a dimensão sexo.
            if row.get("Dim1") not in (None, "SEX_BTSX"):
                continue
            value = row.get("NumericValue")
            iso3 = str(row.get("SpatialDim") or "")
            if value is None or not re.fullmatch(r"[A-Z]{3}", iso3):
                continue
            records.append({
                "iso3": iso3,
                "country": None,
                "year": int(row["TimeDim"]),
                field: float(value),
            })
        frames.append(pd.DataFrame(records))
    for code, (field, multiplier) in HEALTH_WB_INDICATORS.items():
        frame = _world_bank_rows(code, field, multiplier)
        source_hashes.append(hashlib.sha256(frame.to_csv(index=False).encode()).hexdigest())
        frames.append(frame)
    return _write_parquet(
        _merge_indicator_frames(frames),
        "health_global.parquet",
        source_url="WHO GHO OData API + World Bank Indicators API",
        sha256=hashlib.sha256("".join(source_hashes).encode()).hexdigest(),
        dataset="health_global",
    )


def generate_security_global() -> Path:
    frame = _world_bank_rows("VC.IHR.PSRC.P5", "homicideRate")
    return _write_parquet(
        _merge_indicator_frames([frame]),
        "security_global.parquet",
        source_url=(
            f"{WORLD_BANK_API}/country/all/indicator/VC.IHR.PSRC.P5"
            "?format=json&per_page=20000"
        ),
        sha256=hashlib.sha256(frame.to_csv(index=False).encode()).hexdigest(),
        dataset="security_global",
    )


def _latest_fbsp_xlsx() -> str:
    content, _ = _download(FBSP_PAGE_URL)
    links = re.findall(
        rb"https?://[^\"']+/anuario-(\d{4})\.xlsx(?:\?[^\"']*)?",
        content,
        flags=re.IGNORECASE,
    )
    if not links:
        raise RuntimeError("A página oficial do FBSP não publicou link XLSX reconhecível.")
    candidates = []
    for match in re.finditer(
        rb"https?://[^\"']+/anuario-(\d{4})\.xlsx(?:\?[^\"']*)?",
        content,
        flags=re.IGNORECASE,
    ):
        candidates.append((int(match.group(1)), match.group(0).decode("utf-8")))
    return max(candidates)[1]


def _number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(".", "").replace(",", "."))
    except (TypeError, ValueError):
        return None


def _sheet_territories(sheet: openpyxl.worksheet.worksheet.Worksheet) -> dict[str, list[Any]]:
    result = {}
    for row in sheet.iter_rows(values_only=True):
        name = str(row[0] or "").strip()
        normalized = _normalized_column(name).replace("_", " ")
        if normalized == "brasil" or normalized in UF_BY_NAME:
            result[normalized] = list(row)
    return result


def _sheet_latest_year(sheet: openpyxl.worksheet.worksheet.Worksheet) -> int:
    years = []
    for row in sheet.iter_rows(min_row=1, max_row=10, values_only=True):
        for value in row:
            matches = re.findall(r"(?<!\d)20\d{2}(?!\d)", str(value or ""))
            years.extend(
                year
                for year in map(int, matches)
                if 2000 <= year <= dt.date.today().year
            )
    if not years:
        raise ValueError(f"Ano não encontrado na planilha {sheet.title}.")
    return max(years)


def _fbsp_selected(workbook: openpyxl.Workbook) -> pd.DataFrame:
    specs = {
        "T01": ("mviRate", 14, "mvi", 12),
        "T11": ("vehicleTheftRate", 14, None, None),
        "T21": ("femicideRate", 9, None, None),
        "T24": ("domesticViolenceRate", 4, None, None),
    }
    combined: dict[str, dict[str, Any]] = {}
    latest_year = None
    for sheet_name, (rate_field, rate_index, count_field, count_index) in specs.items():
        sheet = workbook[sheet_name]
        latest_year = max(latest_year or 0, _sheet_latest_year(sheet))
        for name, row in _sheet_territories(sheet).items():
            territory_id = "BRA" if name == "brasil" else UF_BY_NAME[name]
            record = combined.setdefault(territory_id, {
                "territory_id": territory_id,
                "territory_name": str(row[0]).strip(),
                "territory_type": "country" if territory_id == "BRA" else "state",
            })
            record[rate_field] = _number(row[rate_index])
            if count_field:
                record[count_field] = _number(row[count_index])
    for record in combined.values():
        record["year"] = latest_year
    result = pd.DataFrame(combined.values())
    if len(result) != 28:
        raise ValueError(f"Esperadas 28 linhas (Brasil + 27 UFs), recebidas {len(result)}.")
    return result.sort_values("territory_id").reset_index(drop=True)


def _fbsp_cells(workbook: openpyxl.Workbook) -> pd.DataFrame:
    records = []
    for sheet_name in workbook.sheetnames:
        sheet = workbook[sheet_name]
        for row in sheet.iter_rows():
            for cell in row:
                if cell.value is not None:
                    records.append({
                        "sheet": sheet_name,
                        "row": cell.row,
                        "column": cell.column,
                        "value": str(cell.value),
                    })
    return pd.DataFrame(records)


def generate_security_brazil() -> list[Path]:
    source_url = _latest_fbsp_xlsx()
    content, digest = _download(source_url)
    workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    selected = _write_parquet(
        _fbsp_selected(workbook),
        "security_brazil.parquet",
        source_url=source_url,
        sha256=digest,
        dataset="security_brazil",
    )
    # Conserva todas as tabelas do anuário em formato compacto, sem manter o XLSX.
    raw = _write_parquet(
        _fbsp_cells(workbook),
        "security_brazil_source_tables.parquet",
        source_url=source_url,
        sha256=digest,
        dataset="security_brazil_source_tables",
    )
    return [selected, raw]


GENERATORS: dict[str, Callable[[], Any]] = {
    "hdi_global": generate_hdi_global,
    "hdi_owid": generate_hdi_owid,
    "idhm_brazil": generate_idhm_brazil,
    "health_global": generate_health_global,
    "security_global": generate_security_global,
    "security_brazil": generate_security_brazil,
}


def main() -> int:
    global UNDP_HDI_URL, IDHM_URL

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--datasets",
        default="all",
        help="all ou lista separada por vírgulas: " + ",".join(GENERATORS),
    )
    parser.add_argument("--undp-url", default=UNDP_HDI_URL)
    parser.add_argument("--idhm-url", default=IDHM_URL)
    args = parser.parse_args()

    UNDP_HDI_URL = args.undp_url
    IDHM_URL = args.idhm_url

    selected = list(GENERATORS) if args.datasets == "all" else [
        item.strip() for item in args.datasets.split(",") if item.strip()
    ]
    invalid = sorted(set(selected) - set(GENERATORS))
    if invalid:
        parser.error(f"datasets inválidos: {', '.join(invalid)}")

    with tempfile.TemporaryDirectory(prefix="atlas_brasil_etl_"):
        for dataset in selected:
            print(f"[{dataset}] atualizando da fonte oficial...")
            GENERATORS[dataset]()
    print("ETL concluída: nenhum arquivo intermediário foi mantido.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
