"""CNES profissionais (health workers) per municipality.

CNES group 'PF' lists each professional x establishment vinculo. Schema
(relevant columns):
    CODUFMUN : 6-digit IBGE municipality of the establishment
    CBO      : 6-digit CBO 2002 occupation code
    CNS_PROF : Cartao Nacional de Saude, unique professional identifier
               (CNS_PROF in the raw export is anonymized to '1' and unusable
                for deduplication)

CBO categories used here:
    Medicos     : prefix '225' (cliniccos, cirurgicos, especialistas) +
                  legacy prefix '2231' (algumas bases antigas)
    Enfermeiros : prefix '2235' (enfermeiros de nivel superior)
                  Note: prefix '3222' / '322205' = auxiliar/tecnico de
                  enfermagem (excluido aqui).
"""

import pandas as pd

from pysus import cnes

from . import UFS


MEDICO_PREFIXES = ("225", "2231")
ENFERMEIRO_PREFIXES = ("2235",)


def fetch_cnes_profissionais(year: int, month: int, ufs=None) -> pd.DataFrame:
    target_ufs = ufs or UFS
    frames = []
    for uf in target_ufs:
        df = cnes(state=uf, year=year, month=month, group="PF")
        if df is None or df.empty:
            continue
        frames.append(df[["CODUFMUN", "CBO", "CNS_PROF"]])
    if not frames:
        return pd.DataFrame()
    combined = pd.concat(frames, ignore_index=True)
    combined["CBO"] = combined["CBO"].astype(str).str.strip()
    return combined


def _has_prefix(cbo: pd.Series, prefixes) -> pd.Series:
    mask = pd.Series(False, index=cbo.index)
    for p in prefixes:
        mask = mask | cbo.str.startswith(p)
    return mask


def aggregate_profissionais_by_municipality(df: pd.DataFrame) -> pd.DataFrame:
    """Return per-CODUFMUN counts of distinct medicos and enfermeiros.

    A professional with multiple vinculos in the same municipality is counted
    once. A professional with vinculos in multiple municipalities is counted
    once per municipality.
    """
    if df.empty:
        return pd.DataFrame(columns=["medicos", "enfermeiros"])

    medico_mask = _has_prefix(df["CBO"], MEDICO_PREFIXES)
    enf_mask = _has_prefix(df["CBO"], ENFERMEIRO_PREFIXES)

    medicos = (
        df.loc[medico_mask]
        .drop_duplicates(subset=["CODUFMUN", "CNS_PROF"])
        .groupby("CODUFMUN")
        .size()
        .rename("medicos")
    )
    enfermeiros = (
        df.loc[enf_mask]
        .drop_duplicates(subset=["CODUFMUN", "CNS_PROF"])
        .groupby("CODUFMUN")
        .size()
        .rename("enfermeiros")
    )
    out = pd.concat([medicos, enfermeiros], axis=1).fillna(0).astype(int)
    out.index = out.index.astype(str).str.zfill(6)
    return out


def compute_rates(profs: pd.DataFrame, six_to_seven: dict, population: dict):
    """Return {ibge7: {medicos, enfermeiros, doctorsPer1000, nursesPer1000}}."""
    result = {}
    for code6, row in profs.iterrows():
        code7 = six_to_seven.get(code6)
        if not code7:
            continue
        pop = population.get(code7)
        if not pop or pop <= 0:
            continue
        medicos = int(row["medicos"])
        enfermeiros = int(row["enfermeiros"])
        result[code7] = {
            "medicos": medicos,
            "enfermeiros": enfermeiros,
            "doctorsPer1000": round(medicos / pop * 1000, 2),
            "nursesPer1000": round(enfermeiros / pop * 1000, 2),
        }
    return result


if __name__ == "__main__":
    import argparse
    from .population import fetch_population_by_ibge
    from . import six_to_seven_map

    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=2024)
    parser.add_argument("--month", type=int, default=1)
    parser.add_argument("--ufs", nargs="*")
    args = parser.parse_args()

    df = fetch_cnes_profissionais(args.year, args.month, args.ufs)
    print(f"PF rows: {len(df):,}")
    agg = aggregate_profissionais_by_municipality(df)
    print(f"Aggregated municipalities: {len(agg):,}")

    pop = fetch_population_by_ibge()
    rates = compute_rates(agg, six_to_seven_map(pop.keys()), pop)
    print(f"With population join: {len(rates):,}")

    for code, row in list(rates.items())[:5]:
        print(f"  {code} medicos/1000={row['doctorsPer1000']} enf/1000={row['nursesPer1000']}")
