"""Infant and maternal mortality from SIM + SINASC (3-year moving average).

SIM (Sistema de Informacoes sobre Mortalidade): one row per death.
    CODMUNRES : 6-digit IBGE municipality of residence
    IDADE     : coded age. First digit = unit, rest = value:
                  1 = horas, 2 = dias, 3 = meses, 4 = anos, 5 = '100+ anos'
                  e.g. '459' = 59 anos, '301' = 1 mes, '201' = 1 dia
                Infant death: unit in {1,2,3} (< 1 year).
    CAUSABAS  : CID-10. Maternal: O00-O99 (and A34 - tetano obstetrico).
    SEXO      : 1=M, 2=F.

SINASC (Sistema de Informacoes sobre Nascidos Vivos): one row per live birth.
    CODMUNRES : 6-digit IBGE municipality of residence of the mother.

Indicators produced:
    infantMortality   : deaths of residents <1 yr per 1.000 live births
    maternalMortality : maternal deaths of residents per 100.000 live births

A 3-year moving window is used (year, year-1, year-2) so small municipalities
do not see wild swings driven by a single death.
"""

import pandas as pd

from . import UFS
from .source import (
    SIM_DIRECTORY,
    SINASC_DIRECTORIES,
    DatasusFTPSource,
    sim_filename,
    sinasc_filename,
)


def _normalize_code(series: pd.Series) -> pd.Series:
    return series.astype(str).str.strip().str.zfill(6)


def _fetch_sim_year(year: int, ufs, source: DatasusFTPSource):
    frames = []
    columns = ["CODMUNRES", "IDADE", "CAUSABAS", "SEXO"]
    for uf in ufs:
        try:
            df = source.read_table(
                SIM_DIRECTORY,
                sim_filename(uf, year),
                columns,
            )
        except FileNotFoundError:
            continue
        if not df.empty:
            frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def _fetch_sinasc_year(year: int, ufs, source: DatasusFTPSource):
    frames = []
    for uf in ufs:
        filename = sinasc_filename(uf, year)
        candidates = ((directory, filename) for directory in SINASC_DIRECTORIES)
        try:
            df = source.read_first_available(candidates, ["CODMUNRES"])
        except FileNotFoundError:
            continue
        if not df.empty:
            frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def aggregate_deaths(sim_df: pd.DataFrame):
    """Return DataFrame indexed by 6-digit IBGE with columns:
        infant_deaths    : deaths under 1 year (IDADE unit in 1,2,3)
        maternal_deaths  : female deaths with CAUSABAS starting with 'O'
                           (CID-10 O00-O99) plus 'A34' (tetano obstetrico).
    """
    if sim_df.empty:
        return pd.DataFrame(columns=["infant_deaths", "maternal_deaths"])

    idade = sim_df["IDADE"].astype(str).str.strip()
    causa = sim_df["CAUSABAS"].astype(str).str.strip().str.upper()
    sexo = sim_df["SEXO"].astype(str).str.strip()
    codes = _normalize_code(sim_df["CODMUNRES"])

    infant_mask = idade.str.len().ge(1) & idade.str[0].isin(["1", "2", "3"])
    maternal_mask = (causa.str.startswith("O") | causa.str.startswith("A34")) & sexo.eq("2")

    infant = codes[infant_mask].value_counts().rename("infant_deaths")
    maternal = codes[maternal_mask].value_counts().rename("maternal_deaths")
    out = pd.concat([infant, maternal], axis=1).fillna(0).astype(int)
    return out


def aggregate_births(sinasc_df: pd.DataFrame):
    if sinasc_df.empty:
        return pd.Series(dtype=int, name="live_births")
    codes = _normalize_code(sinasc_df["CODMUNRES"])
    return codes.value_counts().rename("live_births")


def fetch_mortality_3yr_avg(end_year: int, ufs=None, progress: bool = False):
    """Fetch (end_year, end_year-1, end_year-2) and aggregate.

    Returns DataFrame indexed by 6-digit IBGE with:
        infant_deaths_3y, maternal_deaths_3y, live_births_3y
    """
    target_ufs = ufs or UFS
    years = [end_year, end_year - 1, end_year - 2]

    death_frames = []
    birth_series = []
    with DatasusFTPSource() as source:
        for year in years:
            for uf in target_ufs:
                sim_df = _fetch_sim_year(year, [uf], source)
                agg = aggregate_deaths(sim_df)
                sim_rows = len(sim_df)
                del sim_df
                if not agg.empty:
                    death_frames.append(agg)
                sinasc_df = _fetch_sinasc_year(year, [uf], source)
                births = aggregate_births(sinasc_df)
                sinasc_rows = len(sinasc_df)
                del sinasc_df
                if not births.empty:
                    birth_series.append(births)
                if progress:
                    print(
                        f"      {year} {uf}: SIM {sim_rows:,} / "
                        f"SINASC {sinasc_rows:,} registros",
                        flush=True,
                    )

    if death_frames:
        deaths_3y = (
            pd.concat(death_frames)
            .groupby(level=0)
            .sum()
            .fillna(0)
            .astype(int)
        )
    else:
        deaths_3y = pd.DataFrame(columns=["infant_deaths", "maternal_deaths"])
    deaths_3y.columns = ["infant_deaths_3y", "maternal_deaths_3y"]

    if birth_series:
        births_3y = (
            pd.concat(birth_series, axis=1)
            .fillna(0)
            .sum(axis=1)
            .astype(int)
            .rename("live_births_3y")
        )
    else:
        births_3y = pd.Series(dtype=int, name="live_births_3y")

    return pd.concat([deaths_3y, births_3y], axis=1).fillna(0).astype(int)


def compute_rates(agg: pd.DataFrame, six_to_seven: dict):
    """Return {ibge7: {infantMortality, maternalMortality}}.

    Uses 3-year aggregates already in `agg`. Excludes municipalities with
    less than 30 live births in 3 years (rate too unstable to report).
    """
    MIN_BIRTHS = 30
    result = {}
    for code6, row in agg.iterrows():
        code7 = six_to_seven.get(code6)
        if not code7:
            continue
        births = int(row["live_births_3y"])
        if births < MIN_BIRTHS:
            continue
        infant = int(row["infant_deaths_3y"])
        maternal = int(row["maternal_deaths_3y"])
        result[code7] = {
            "infant_deaths_3y": infant,
            "maternal_deaths_3y": maternal,
            "live_births_3y": births,
            "infantMortality": round(infant / births * 1000, 1),
            "maternalMortality": round(maternal / births * 100_000, 1),
        }
    return result


if __name__ == "__main__":
    import argparse
    from .population import fetch_population_by_ibge
    from . import six_to_seven_map

    parser = argparse.ArgumentParser()
    parser.add_argument("--end-year", type=int, default=2022,
                        help="Latest year of the 3-year window (window is end_year, -1, -2)")
    parser.add_argument("--ufs", nargs="*")
    args = parser.parse_args()

    agg = fetch_mortality_3yr_avg(args.end_year, args.ufs)
    print(f"Aggregated municipalities: {len(agg):,}")
    pop = fetch_population_by_ibge()
    rates = compute_rates(agg, six_to_seven_map(pop.keys()))
    print(f"With population join and >=30 births: {len(rates):,}")
    for code, row in list(rates.items())[:5]:
        print(f"  {code} infantMort={row['infantMortality']} maternalMort={row['maternalMortality']}")
