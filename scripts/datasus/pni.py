"""Cobertura vacinal municipal a partir do PNI legado.

LIMITATION: o catalogo pysus expoe PNI somente ate 2019. A partir de 2020 a
cobertura passou a ser registrada no SI-PNI nominal (e-SUS) e nao esta no
mesmo formato. Para dados recentes, o caminho oficial e:
  - Painel SI-PNI: https://si-pni.saude.gov.br/
  - TabNet PNI:    https://datasus.saude.gov.br/informacoes-de-saude-tabnet/
Esses requerem scraping HTML (TODO em modulo separado).

Para o MVP, usamos o PNI legado (CPNI 2019) por municipio. Campos relevantes:
    MUNIC   : 6-digit IBGE
    IMUNO   : codigo do imunobiologico
    QT_DOSE : doses aplicadas
    POP     : populacao alvo
    COBERT  : cobertura ja calculada pelo PNI (string com virgula decimal)

Indicador produzido:
    vaccinationCoverage : media simples de COBERT entre todos os IMUNOs do
                          municipio (cap em 100%). E um proxy bruto; o ideal
                          seria escolher um imunobiologico de referencia
                          (tetraviral, penta, triplice viral em <1 ano).
"""

import pandas as pd

from pysus import pni

from . import UFS


LEGACY_LAST_YEAR = 2019


def _parse_cobert(value) -> float:
    """COBERT vem como string com virgula decimal ou numero. Retorna float."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace(",", ".")
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def fetch_pni_coverage(year: int = LEGACY_LAST_YEAR, ufs=None) -> pd.DataFrame:
    target_ufs = ufs or UFS
    frames = []
    for uf in target_ufs:
        df = pni(state=uf, year=year, group="CPNI")
        if df is None or df.empty:
            continue
        df = df[["MUNIC", "IMUNO", "QT_DOSE", "POP", "COBERT"]].copy()
        df["COBERT_NUM"] = df["COBERT"].map(_parse_cobert)
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def aggregate_coverage_by_municipality(df: pd.DataFrame) -> pd.DataFrame:
    """Average COBERT_NUM per MUNIC across all IMUNOs.

    Drops rows where COBERT_NUM == 0 (likely missing/erroneous) so the average
    is not pulled down by reporting gaps.
    """
    if df.empty:
        return pd.DataFrame(columns=["vaccinationCoverage"])
    nonzero = df[df["COBERT_NUM"] > 0]
    if nonzero.empty:
        return pd.DataFrame(columns=["vaccinationCoverage"])
    avg = nonzero.groupby("MUNIC")["COBERT_NUM"].mean().rename("vaccinationCoverage")
    avg = avg.clip(upper=100).round(1)
    out = avg.to_frame()
    out.index = out.index.astype(str).str.zfill(6)
    return out


def compute_rates(agg: pd.DataFrame, six_to_seven: dict):
    """Return {ibge7: {vaccinationCoverage, pniYear: 2019, pniProxyLegacy: True}}."""
    result = {}
    for code6, row in agg.iterrows():
        code7 = six_to_seven.get(code6)
        if not code7:
            continue
        cov = float(row["vaccinationCoverage"])
        result[code7] = {
            "vaccinationCoverage": cov,
            "pniYear": LEGACY_LAST_YEAR,
            "pniProxyLegacy": True,
        }
    return result


if __name__ == "__main__":
    import argparse
    from .population import fetch_population_by_ibge
    from . import six_to_seven_map

    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, default=LEGACY_LAST_YEAR,
                        help="Ano do PNI legado (max 2019)")
    parser.add_argument("--ufs", nargs="*")
    args = parser.parse_args()

    df = fetch_pni_coverage(args.year, args.ufs)
    print(f"PNI rows: {len(df):,}")
    agg = aggregate_coverage_by_municipality(df)
    print(f"Aggregated municipalities: {len(agg):,}")

    pop = fetch_population_by_ibge()
    rates = compute_rates(agg, six_to_seven_map(pop.keys()))
    print(f"With population join: {len(rates):,}")
    for code, row in list(rates.items())[:5]:
        print(f"  {code} cov={row['vaccinationCoverage']}%")
