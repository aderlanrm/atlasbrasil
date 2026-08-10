"""Cobertura vacinal municipal a partir do PNI legado.

LIMITATION: o FTP legado do DATASUS expoe CPNI somente ate 2019. A partir de 2020 a
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

from . import UFS
from .source import PNI_DIRECTORY, DatasusFTPSource, pni_filename


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
    columns = ["MUNIC", "IMUNO", "QT_DOSE", "POP", "COBERT"]
    with DatasusFTPSource() as source:
        for uf in target_ufs:
            try:
                df = source.read_table(
                    PNI_DIRECTORY,
                    pni_filename(uf, year),
                    columns,
                )
            except FileNotFoundError:
                continue
            if df.empty:
                continue
            df["COBERT_NUM"] = df["COBERT"].map(_parse_cobert)
            frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def aggregate_coverage_by_municipality(df: pd.DataFrame) -> pd.DataFrame:
    """Calcula a cobertura vacinal focando nas vacinas sentinela:
    - Tríplice Viral D1 (código '94') ou Pentavalente (código '73').
    - Se nenhuma estiver disponível com cobertura > 0, faz o fallback para a média simples de outros imunobiológicos.
    """
    if df.empty:
        return pd.DataFrame(columns=["vaccinationCoverage"])
    
    # Normalizar o código IMUNO (removendo zeros à esquerda)
    df = df.copy()
    df["IMUNO_NORM"] = df["IMUNO"].astype(str).str.strip().str.lstrip("0")
    
    results = {}
    for munic, group in df.groupby("MUNIC"):
        valid_group = group[group["COBERT_NUM"] > 0]
        if valid_group.empty:
            continue
            
        # Tentar buscar Tríplice Viral D1 ("94")
        triplice = valid_group[valid_group["IMUNO_NORM"] == "94"]
        if not triplice.empty:
            results[munic] = triplice["COBERT_NUM"].iloc[0]
            continue
            
        # Tentar buscar Pentavalente ("73")
        penta = valid_group[valid_group["IMUNO_NORM"] == "73"]
        if not penta.empty:
            results[munic] = penta["COBERT_NUM"].iloc[0]
            continue
            
        # Fallback: média de todos os outros imunobiológicos com valor > 0
        results[munic] = valid_group["COBERT_NUM"].mean()

    if not results:
        return pd.DataFrame(columns=["vaccinationCoverage"])
        
    s = pd.Series(results, name="vaccinationCoverage")
    s = s.clip(upper=100).round(1)
    out = s.to_frame()
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
