"""CNES leitos (beds) aggregated by municipality.

CNES group 'LT' lists every bed registered in the country, one row per
CNES facility x bed type. Schema (relevant columns):
    CODUFMUN : 6-digit IBGE municipality code
    TP_LEITO : bed broad category
               1=Cirurgico, 2=Clinico, 3=Complementar (UTI/UCI),
               4=Obstetrico, 5=Pediatrico, 6=Hospital-dia, 7=Outras
    CODLEITO : specific bed code
    QT_EXIST : total beds in the establishment for that (TP_LEITO, CODLEITO)
    QT_SUS   : beds available to SUS
    COMPETEN : competence YYYYMM
"""

import pandas as pd

from pysus import cnes

from . import UFS


def fetch_cnes_leitos(year: int, month: int, ufs=None) -> pd.DataFrame:
    """Concatenate CNES LT for the chosen competence across all UFs.

    Returns a DataFrame with the original CNES columns. Numeric columns are
    coerced to int with 0 fallback.
    """
    target_ufs = ufs or UFS
    frames = []
    for uf in target_ufs:
        df = cnes(state=uf, year=year, month=month, group="LT")
        if df is None or df.empty:
            continue
        frames.append(df)
    if not frames:
        return pd.DataFrame()

    combined = pd.concat(frames, ignore_index=True)
    for col in ("QT_EXIST", "QT_SUS", "QT_NSUS"):
        if col in combined.columns:
            combined[col] = pd.to_numeric(combined[col], errors="coerce").fillna(0).astype(int)
    if "TP_LEITO" in combined.columns:
        combined["TP_LEITO"] = pd.to_numeric(combined["TP_LEITO"], errors="coerce")
    return combined


def aggregate_leitos_by_municipality(df: pd.DataFrame) -> pd.DataFrame:
    """Reduce LT rows to one record per CODUFMUN with totals.

    Columns produced:
        leitos_total  : sum of QT_EXIST across all bed types
        leitos_sus    : sum of QT_SUS  across all bed types
        leitos_uti    : sum of QT_EXIST for TP_LEITO == 3 (Complementar)
    """
    if df.empty:
        return pd.DataFrame(columns=["leitos_total", "leitos_sus", "leitos_uti"])

    total = df.groupby("CODUFMUN")["QT_EXIST"].sum().rename("leitos_total")
    sus = df.groupby("CODUFMUN")["QT_SUS"].sum().rename("leitos_sus")
    if "CODLEITO" in df.columns:
        codleito_numeric = pd.to_numeric(df["CODLEITO"], errors="coerce")
        uti_mask = (df["TP_LEITO"] == 3) & (codleito_numeric >= 74) & (codleito_numeric <= 83)
    else:
        uti_mask = df["TP_LEITO"] == 3
    uti = df.loc[uti_mask].groupby("CODUFMUN")["QT_EXIST"].sum().rename("leitos_uti")
    out = pd.concat([total, sus, uti], axis=1).fillna(0).astype(int)
    out.index = out.index.astype(str).str.zfill(6)
    return out


def compute_rates(leitos: pd.DataFrame, six_to_seven: dict, population: dict):
    """Return {ibge7: {bedsPer1000, susBedsPer1000, icuBedsPer100k, leitos_total, ...}}.

    Only municipalities present in both the leitos aggregate AND the population
    dict are returned. Caller decides what to do with the rest (proxy fallback).
    """
    result = {}
    for code6, row in leitos.iterrows():
        code7 = six_to_seven.get(code6)
        if not code7:
            continue
        pop = population.get(code7)
        if not pop or pop <= 0:
            continue
        total = int(row["leitos_total"])
        sus = int(row["leitos_sus"])
        uti = int(row["leitos_uti"])
        result[code7] = {
            "leitos_total": total,
            "leitos_sus": sus,
            "leitos_uti": uti,
            "bedsPer1000": round(total / pop * 1000, 2),
            "susBedsPer1000": round(sus / pop * 1000, 2),
            "icuBedsPer100k": round(uti / pop * 100_000, 1),
        }
    return result


if __name__ == "__main__":
    import argparse
    from .population import fetch_population_by_ibge
    from . import six_to_seven_map

    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=2024)
    parser.add_argument("--month", type=int, default=1)
    parser.add_argument("--ufs", nargs="*", help="Optional subset of UFs")
    args = parser.parse_args()

    print(f"Fetching CNES LT {args.year}-{args.month:02d} for {args.ufs or 'all UFs'}...")
    df = fetch_cnes_leitos(args.year, args.month, args.ufs)
    print(f"  rows: {len(df):,}  municipalities: {df['CODUFMUN'].nunique():,}")
    agg = aggregate_leitos_by_municipality(df)
    print(f"  aggregated: {len(agg):,} municipalities")

    pop = fetch_population_by_ibge()
    six_seven = six_to_seven_map(pop.keys())
    rates = compute_rates(agg, six_seven, pop)
    print(f"  with population join: {len(rates):,} municipalities")

    sample = list(rates.items())[:5]
    for code, row in sample:
        print(f"  {code} beds/1000={row['bedsPer1000']} susBeds/1000={row['susBedsPer1000']} icu/100k={row['icuBedsPer100k']}")
