"""CNES profissionais (health workers) per municipality.

CNES group 'PF' lists each professional x establishment vinculo. Schema
(relevant columns):
    CODUFMUN : 6-digit IBGE municipality of the establishment
    CBO      : 6-digit CBO 2002 occupation code
    CNS_PROF : Cartao Nacional de Saude, identificador usado para eliminar
               vinculos duplicados do mesmo profissional no municipio

CBO categories used here:
    Medicos     : prefix '225' (cliniccos, cirurgicos, especialistas) +
                  legacy prefix '2231' (algumas bases antigas)
    Enfermeiros : prefix '2235' (enfermeiros de nivel superior)
                  Note: prefix '3222' / '322205' = auxiliar/tecnico de
                  enfermagem (excluido aqui).
"""

import pandas as pd

from . import UFS
from .source import CNES_DIRECTORY, DatasusFTPSource, cnes_filename


MEDICO_PREFIXES = ("225", "2231")
ENFERMEIRO_PREFIXES = ("2235",)


def fetch_cnes_profissionais(year: int, month: int, ufs=None) -> pd.DataFrame:
    target_ufs = ufs or UFS
    frames = []
    columns = ["CODUFMUN", "CBO", "CNS_PROF"]
    with DatasusFTPSource() as source:
        for uf in target_ufs:
            filename = cnes_filename("PF", uf, year, month)
            try:
                df = source.read_table(f"{CNES_DIRECTORY}/PF", filename, columns)
            except FileNotFoundError:
                continue
            if not df.empty:
                frames.append(df)
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


def fetch_cnes_profissionais_aggregated(
    year: int,
    month: int,
    ufs=None,
    progress: bool = False,
) -> pd.DataFrame:
    """Baixe e agregue PF por UF, sem acumular o cadastro nacional bruto."""
    target_ufs = ufs or UFS
    columns = ["CODUFMUN", "CBO", "CNS_PROF"]
    frames = []
    with DatasusFTPSource() as source:
        for uf in target_ufs:
            filename = cnes_filename("PF", uf, year, month)
            if progress:
                print(f"      PF {uf}: lendo {filename}...", end="", flush=True)
            try:
                raw = source.read_table(f"{CNES_DIRECTORY}/PF", filename, columns)
            except FileNotFoundError:
                if progress:
                    print(" não encontrado")
                continue
            raw["CBO"] = raw["CBO"].str.strip()
            aggregated = aggregate_profissionais_by_municipality(raw)
            del raw
            if not aggregated.empty:
                frames.append(aggregated)
            if progress:
                print(f" {len(aggregated):,} municípios")

    if not frames:
        return pd.DataFrame(columns=["medicos", "enfermeiros"])
    return pd.concat(frames).groupby(level=0).sum().astype(int)


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

    agg = fetch_cnes_profissionais_aggregated(args.year, args.month, args.ufs)
    print(f"Aggregated municipalities: {len(agg):,}")

    pop = fetch_population_by_ibge()
    rates = compute_rates(agg, six_to_seven_map(pop.keys()), pop)
    print(f"With population join: {len(rates):,}")

    for code, row in list(rates.items())[:5]:
        print(f"  {code} medicos/1000={row['doctorsPer1000']} enf/1000={row['nursesPer1000']}")
