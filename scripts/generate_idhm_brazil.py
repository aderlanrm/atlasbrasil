"""Gera data/idhm_brazil.json a partir da planilha oficial do Painel IDHM (PNUD Brasil).

=============================================================================
O QUE ESTE SCRIPT FAZ
=============================================================================
O app (app.js) carrega `data/idhm_brazil.json` para mostrar o IDHM anual do
Brasil e das 27 UFs (e usa a UF como proxy nas cidades). Este script converte a
planilha bruta oficial -> esse JSON, no formato exato que o app espera.

A planilha oficial é a "Base de dados (xls)" do Painel IDHM / Atlas do
Desenvolvimento Humano no Brasil (parceria PNUD + IPEA + FJP), com uma linha por
ANO x AGREGACAO x território. Cada nova edição do Radar IDHM publica uma planilha
nova (ex.: a edição 2026 estendeu e RECALCULOU a série para 2012-2024).

=============================================================================
COMO ATUALIZAR QUANDO SAIR UMA EDIÇÃO NOVA  (passo a passo reutilizável)
=============================================================================
1. Abra a página "Base de dados (xls)" do Painel IDHM no navegador:
     https://www.undp.org/pt/brazil/desenvolvimento-humano/painel-idhm
     (link direto da planilha:
      https://www.undp.org/pt/brazil/desenvolvimento-humano/publications/base-de-dados-xls)
   Clique com o botão direito no botão de download e copie o endereço do .xlsx.
   Obs.: as PÁGINAS html do undp.org bloqueiam download automatizado (403), mas o
   SERVIDOR DE ARQUIVOS (https://www.undp.org/sites/g/files/.../base_de_dados.xlsx)
   entrega o .xlsx direto. Por isso passamos a URL do arquivo em --url.

2. Rode uma das opções:
     # baixa a planilha nova, salva em data/idhm_pnud_brazil.xlsx e regenera o JSON
     python scripts/generate_idhm_brazil.py --url "<URL_DO_XLSX>"

     # ou, se você já baixou o arquivo manualmente para data/idhm_pnud_brazil.xlsx
     python scripts/generate_idhm_brazil.py

     # apenas conferir se o JSON atual bate com a planilha local (não escreve nada)
     python scripts/generate_idhm_brazil.py --check

3. Confira o resumo impresso (anos, latestYear, IDHM do Brasil no último ano) com a
   fonte oficial. Depois atualize, em app.js -> DATA_SOURCE_CATALOG.idhmPnudBrazil,
   os campos `freshness` (ex.: "IDHM anual 2012-2024..."), `url`/`fileUrl` e
   `methodology`/`limitations`/`note` se a metodologia ou a cobertura mudaram.

=============================================================================
MAPEAMENTO COLUNA (planilha) -> CAMPO (json)   [validado: 480 conferências, 0 erros]
=============================================================================
    IDHM     -> idhm              (3 casas)   IDHM geral
    IDHM_L   -> longevity         (3 casas)   subíndice Longevidade
    IDHM_E   -> education         (3 casas)   subíndice Educação
    IDHM_R   -> income            (3 casas)   subíndice Renda
    IDHMAD   -> adjusted          (3 casas)   IDHM ajustado à desigualdade (IDHMAD)
    ESPVIDA  -> lifeExpectancy    (2 casas)   esperança de vida ao nascer (anos)
    RDPC     -> incomePerCapita   (2 casas)   renda domiciliar per capita (R$)
    GINI     -> gini              (3 casas)   índice de Gini
Linhas usadas: AGREGACAO == "BRASIL" (nacional) e AGREGACAO == "UF" (estados).
As demais agregações da planilha (RM_RIDE etc.) são ignoradas de propósito.

ESTRUTURA DO JSON GERADO
    {
      "source": {label, url, fileUrl, downloadedAt, note},
      "latestYear": <int>,
      "years": ["2012", ..., "2024"],          # strings, ordem crescente
      "brazil": {"history": {"<ano>": {<8 campos>}}},
      "states": {"<cod_uf>": {"id", "name", "history": {"<ano>": {<8 campos>}}}}
    }
"""

import argparse
import json
import math
import urllib.request
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "idhm_pnud_brazil.xlsx"
DEFAULT_OUTPUT = ROOT / "data" / "idhm_brazil.json"

# Nome da aba com a base tabular (uma linha por ANO x AGREGACAO x território).
SHEET_NAME = "Base de Dados"

# Página de referência da fonte (vai para source.url no JSON).
SOURCE_PAGE_URL = "https://www.undp.org/pt/brazil/desenvolvimento-humano/painel-idhm"
# URL do arquivo bruto usado por padrão (sobrescrita por --url / --file-url).
DEFAULT_FILE_URL = (
    "https://www.undp.org/sites/g/files/zskgke326/files/2023-07/base_de_dados.xlsx"
)
SOURCE_NOTE = (
    "Base anual com IDHM e componentes para Brasil e UFs, calculada com PNAD "
    "Continua/IBGE (Painel IDHM / Radar IDHM - PNUD, IPEA e FJP)."
)

# (campo_json, coluna_planilha, casas_decimais)
COLUMN_MAP = (
    ("idhm", "IDHM", 3),
    ("longevity", "IDHM_L", 3),
    ("education", "IDHM_E", 3),
    ("income", "IDHM_R", 3),
    ("adjusted", "IDHMAD", 3),
    ("lifeExpectancy", "ESPVIDA", 2),
    ("incomePerCapita", "RDPC", 2),
    ("gini", "GINI", 3),
)

# Cabeçalho de browser: o servidor de arquivos do UNDP recusa user-agents "robô".
HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "pt-BR,pt;q=0.9",
}


def download_xlsx(url: str, dest: Path) -> None:
    """Baixa a planilha de `url` e salva em `dest` (sobrescreve)."""
    print(f"baixando planilha: {url}")
    req = urllib.request.Request(url, headers=HTTP_HEADERS)
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = resp.read()
    if data[:2] != b"PK":  # .xlsx é um zip -> começa com "PK"
        raise SystemExit(
            "conteúdo baixado não parece um .xlsx (início != 'PK'). "
            "Confirme a URL do arquivo na página 'Base de dados (xls)'."
        )
    dest.write_bytes(data)
    print(f"salvo em {dest} ({len(data)} bytes)")


def round_field(value, decimals: int):
    """Arredonda e limpa NaN. Retorna None quando o valor não existe na planilha."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number):
        return None
    return round(number, decimals)


def history_for_rows(rows: pd.DataFrame) -> dict:
    """Monta {"<ano>": {<8 campos>}} para as linhas de um único território."""
    history = {}
    for _, row in rows.sort_values("ANO").iterrows():
        year = str(int(row["ANO"]))
        history[year] = {
            field: round_field(row.get(column), decimals)
            for field, column, decimals in COLUMN_MAP
        }
    return history


def build(df: pd.DataFrame, file_url: str, downloaded_at: str) -> dict:
    """Constrói o dicionário final no formato consumido pelo app."""
    # Normaliza a coluna de agregação (tira espaços e padroniza maiúsculas).
    df = df.copy()
    df["AGREGACAO"] = df["AGREGACAO"].astype(str).str.strip().str.upper()

    brazil_rows = df[df["AGREGACAO"] == "BRASIL"]
    uf_rows = df[df["AGREGACAO"] == "UF"]
    if brazil_rows.empty or uf_rows.empty:
        raise SystemExit(
            "planilha sem linhas BRASIL e/ou UF na coluna AGREGACAO; "
            f"valores encontrados: {sorted(df['AGREGACAO'].unique())}"
        )

    years = sorted({int(y) for y in df[df["AGREGACAO"].isin(["BRASIL", "UF"])]["ANO"]})

    states = {}
    for code, rows in uf_rows.groupby("CODIGO"):
        code_str = str(int(code))
        states[code_str] = {
            "id": code_str,
            "name": str(rows.iloc[0]["NOME"]).strip(),
            "history": history_for_rows(rows),
        }

    return {
        "source": {
            "label": "PNUD Brasil - Painel IDHM",
            "url": SOURCE_PAGE_URL,
            "fileUrl": file_url,
            "downloadedAt": downloaded_at,
            "note": SOURCE_NOTE,
        },
        "latestYear": years[-1],
        "years": [str(y) for y in years],
        "brazil": {"history": history_for_rows(brazil_rows)},
        # ordena os estados pelo código da UF (11, 12, ... 53)
        "states": {code: states[code] for code in sorted(states, key=int)},
    }


def check_against(generated: dict, existing_path: Path) -> int:
    """Compara os valores gerados com um JSON existente. Retorna nº de divergências."""
    existing = json.loads(existing_path.read_text(encoding="utf-8-sig"))
    mismatches = 0
    checks = 0

    def compare(label, gen_hist, old_hist):
        nonlocal mismatches, checks
        for year, old_entry in old_hist.items():
            gen_entry = gen_hist.get(year, {})
            for field, old_value in old_entry.items():
                checks += 1
                new_value = gen_entry.get(field)
                if old_value is None and new_value is None:
                    continue
                if old_value is None or new_value is None or abs(float(new_value) - float(old_value)) > 5e-4:
                    mismatches += 1
                    if mismatches <= 30:
                        print(f"  DIFF {label} {year} {field}: novo={new_value} atual={old_value}")

    compare("BRASIL", generated["brazil"]["history"], existing["brazil"]["history"])
    for code, state in existing["states"].items():
        gen_state = generated["states"].get(code, {})
        compare(f"UF {code}", gen_state.get("history", {}), state["history"])

    print(f"conferência: {checks} valores, {mismatches} divergências")
    return mismatches


def print_summary(data: dict) -> None:
    print("-" * 60)
    print("anos:", ", ".join(data["years"]))
    print("latestYear:", data["latestYear"])
    print("UFs:", len(data["states"]))
    latest = str(data["latestYear"])
    br = data["brazil"]["history"].get(latest, {})
    print(f"Brasil {latest}: IDHM={br.get('idhm')} L={br.get('longevity')} "
          f"E={br.get('education')} R={br.get('income')}")
    sample = data["states"].get("35") or next(iter(data["states"].values()))
    s_latest = sample["history"].get(latest, {})
    print(f"amostra {sample['name']} {latest}: IDHM={s_latest.get('idhm')}")
    print("-" * 60)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--url", help="URL do .xlsx para baixar (salva em --input e regenera).")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT,
                        help=f"planilha local de entrada (padrão: {DEFAULT_INPUT}).")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT,
                        help=f"JSON de saída (padrão: {DEFAULT_OUTPUT}).")
    parser.add_argument("--file-url", help="valor para source.fileUrl (padrão: --url ou a URL conhecida).")
    parser.add_argument("--downloaded-at", default=date.today().isoformat(),
                        help="valor para source.downloadedAt (padrão: hoje).")
    parser.add_argument("--check", action="store_true",
                        help="apenas compara com o JSON existente; não escreve.")
    args = parser.parse_args()

    if args.url:
        download_xlsx(args.url, args.input)
    if not args.input.exists():
        raise SystemExit(f"planilha não encontrada: {args.input} (use --url para baixar).")

    df = pd.read_excel(args.input, sheet_name=SHEET_NAME)
    file_url = args.file_url or args.url or DEFAULT_FILE_URL
    data = build(df, file_url=file_url, downloaded_at=args.downloaded_at)
    print_summary(data)

    if args.check:
        mismatches = check_against(data, args.out)
        raise SystemExit(0 if mismatches == 0 else 1)

    args.out.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"escrito: {args.out}")


if __name__ == "__main__":
    main()
