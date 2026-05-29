"""Gera data/idhm_brazil.json a partir do relatório PDF do Radar IDHM (PNUD/IPEA-FJP/IBGE).

=============================================================================
POR QUE ESTE SCRIPT EXISTE
=============================================================================
A forma canônica de atualizar o IDHM é pela planilha oficial "Base de dados (xls)"
do Painel IDHM -> use scripts/generate_idhm_brazil.py (veja docs/DADOS.md).

Porém, na edição 2026 do Radar IDHM (série recalculada 2012-2024), a PLANILHA ainda
não estava publicada quando precisávamos atualizar; só saiu o RELATÓRIO em PDF, que
traz a série completa em tabelas-anexo. Este script extrai essas tabelas do PDF e
gera o mesmo JSON que o app consome. Use-o quando só houver o relatório; quando a
planilha sair, prefira o generate_idhm_brazil.py.

FONTE (rastro): o arquivo data/radar_idhm_web.pdf foi baixado de
https://www.undp.org/pt/brazil/publications/radar-idhm-evolucao-do-idhm-e-de-seus-componentes-periodo-de-2012-2024
O PDF (~85 MB) não é versionado (ver .gitignore); rebaixe-o desse link para reprocessar.

=============================================================================
COMO FUNCIONA
=============================================================================
O relatório tem tabelas-anexo, uma por página, com RANKING / UF / 2012 ... 2024:
    - "IDHM para as Unidades da Federação, 2012 a 2024"              -> idhm
    - "IDHM Longevidade para as Unidades da Federação, 2012 a 2024"  -> longevity
    - "IDHM Educação para as Unidades da Federação, 2012 a 2024"     -> education
    - "IDHM Renda para as Unidades da Federação, 2012 a 2024"        -> income
e tabelas do Brasil:
    - "IDHM das dimensões Educação, Longevidade e Renda, para o Brasil (2012-2024)"  -> idhm + 3 subíndices
    - "IDHMAD e IDHMAD Educação, Longevidade e Renda, para o Brasil (2012-2024)"     -> adjusted (IDHMAD)

O script LOCALIZA cada tabela pela legenda (não por número de página fixo, que muda
entre edições), extrai a grade com pdfplumber (tabelas de UF) ou por regex de linha
(tabelas do Brasil), monta o JSON e VALIDA contra valores-âncora oficiais conhecidos
(ex.: Brasil 2024 = 0,805) antes de escrever. Se a validação falhar, ele aborta.

CAMPOS GERADOS POR (Brasil + UF) x ANO: idhm, longevity, education, income, adjusted.
Observações de cobertura:
  - O app só EXIBE esses 5 campos no IDH; os antigos lifeExpectancy/incomePerCapita/gini
    não eram usados em lugar nenhum do IDH, então foram descartados de propósito.
  - O relatório não publica IDHMAD GERAL por UF (só por sexo/componente), então
    `adjusted` fica null nas UFs (o card de Estado mostra "-" nesse campo) e real no Brasil.

USO:
    python scripts/extract_idhm_from_radar_pdf.py            # usa data/radar_idhm_web.pdf
    python scripts/extract_idhm_from_radar_pdf.py --pdf <arquivo> --check
"""

import argparse
import json
import re
import unicodedata
from datetime import date
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PDF = ROOT / "data" / "radar_idhm_web.pdf"
DEFAULT_OUTPUT = ROOT / "data" / "idhm_brazil.json"

# Página oficial de onde o relatório (radar_idhm_web.pdf) foi baixado. Rastro da fonte.
REPORT_URL = (
    "https://www.undp.org/pt/brazil/publications/"
    "radar-idhm-evolucao-do-idhm-e-de-seus-componentes-periodo-de-2012-2024"
)

YEARS = [str(y) for y in range(2012, 2025)]  # 2012 .. 2024

# Nome canônico (sem acento, minúsculo) da UF -> código IBGE de 2 dígitos.
UF_NAME_TO_CODE = {
    "rondonia": "11", "acre": "12", "amazonas": "13", "roraima": "14",
    "para": "15", "amapa": "16", "tocantins": "17", "maranhao": "21",
    "piaui": "22", "ceara": "23", "rio grande do norte": "24", "paraiba": "25",
    "pernambuco": "26", "alagoas": "27", "sergipe": "28", "bahia": "29",
    "minas gerais": "31", "espirito santo": "32", "rio de janeiro": "33",
    "sao paulo": "35", "parana": "41", "santa catarina": "42",
    "rio grande do sul": "43", "mato grosso do sul": "50", "mato grosso": "51",
    "goias": "52", "distrito federal": "53",
}
# Nome de exibição (com acento) por código, para casar com o padrão do app.
UF_CODE_TO_NAME = {
    "11": "Rondônia", "12": "Acre", "13": "Amazonas", "14": "Roraima",
    "15": "Pará", "16": "Amapá", "17": "Tocantins", "21": "Maranhão",
    "22": "Piauí", "23": "Ceará", "24": "Rio Grande do Norte", "25": "Paraíba",
    "26": "Pernambuco", "27": "Alagoas", "28": "Sergipe", "29": "Bahia",
    "31": "Minas Gerais", "32": "Espírito Santo", "33": "Rio de Janeiro",
    "35": "São Paulo", "41": "Paraná", "42": "Santa Catarina",
    "43": "Rio Grande do Sul", "50": "Mato Grosso do Sul", "51": "Mato Grosso",
    "52": "Goiás", "53": "Distrito Federal",
}

# Legendas das tabelas de UF (forma normalizada, contígua) -> campo do JSON.
UF_TABLE_CAPTIONS = {
    "idhm": "idhm para as unidades da federacao",
    "longevity": "idhm longevidade para as unidades da federacao",
    "education": "idhm educacao para as unidades da federacao",
    "income": "idhm renda para as unidades da federacao",
}
BRAZIL_T1_CAPTION = "idhm das dimensoes educacao longevidade e renda para o brasil"
BRAZIL_T9_CAPTION = "idhmad e idhmad educacao longevidade e renda para o brasil"

# Âncoras oficiais (do próprio relatório / divulgação) para validar a extração.
ANCHORS_BRAZIL = {
    "2012": {"idhm": 0.744, "education": 0.679, "longevity": 0.829, "income": 0.732},
    "2021": {"idhm": 0.757},
    "2024": {"idhm": 0.805, "education": 0.798, "longevity": 0.860, "income": 0.760, "adjusted": 0.641},
}
ANCHORS_UF = {  # codigo: {ano: idhm}
    "35": {"2024": 0.838},  # São Paulo
    "53": {"2024": 0.866},  # Distrito Federal
}


def norm(text: str) -> str:
    """Minúsculo, sem acentos e sem pontuação; espaços colapsados."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def to_float(token: str):
    """'0,824' ou '0.824' -> 0.824 (None se não for número)."""
    token = (token or "").strip().replace(",", ".")
    try:
        return round(float(token), 3)
    except ValueError:
        return None


def find_uf_table(pdf, caption_norm: str):
    """Acha a página cuja legenda bate exatamente e devolve as linhas extraídas."""
    for page in pdf.pages:
        text = norm(page.extract_text() or "")
        if caption_norm not in text:
            continue
        if "por sexo" in text or "por raca" in text or "regioes metropolitanas" in text:
            continue
        table = page.extract_table()
        if table and sum(1 for r in table if r and str(r[0]).strip().isdigit()) >= 27:
            return page.page_number, table
    raise SystemExit(f"tabela de UF não encontrada para legenda: {caption_norm!r}")


def parse_uf_table(table) -> dict:
    """Linhas pdfplumber -> {codigo_uf: {ano: valor}}. Pula cabeçalho e faixas de nível."""
    out = {}
    for row in table:
        if not row or not str(row[0]).strip().isdigit():
            continue  # cabeçalho ("RANKING") ou faixa ("MUITO ALTO ...")
        name_norm = norm(str(row[1]).replace("\n", " "))
        code = UF_NAME_TO_CODE.get(name_norm)
        if not code:
            raise SystemExit(f"UF não reconhecida na tabela: {row[1]!r} (norm={name_norm!r})")
        values = [to_float(c) for c in row[2:2 + len(YEARS)]]
        if len(values) != len(YEARS) or any(v is None for v in values):
            raise SystemExit(f"linha de UF com valores faltando: {row!r}")
        out[code] = dict(zip(YEARS, values))
    if len(out) != 27:
        raise SystemExit(f"esperava 27 UFs, extraí {len(out)}")
    return out


def find_brazil_table_lines(pdf, caption_norm: str):
    """Acha a página da tabela do Brasil e devolve {ano: [valores da linha]}."""
    for page in pdf.pages:
        text = page.extract_text() or ""
        if caption_norm not in norm(text):
            continue
        rows = {}
        for line in text.split("\n"):
            m = re.match(r"^\s*(20\d\d)\s+(.+)$", line)
            if not m or m.group(1) not in YEARS:
                continue
            nums = [to_float(t) for t in re.findall(r"\d[\d.,]*", m.group(2))]
            nums = [n for n in nums if n is not None and 0 < n <= 1][:4]
            if len(nums) == 4:
                rows[m.group(1)] = nums
        if len(rows) == len(YEARS):
            return page.page_number, rows
    raise SystemExit(f"tabela do Brasil não encontrada para legenda: {caption_norm!r}")


def build(pdf_path: Path) -> dict:
    with pdfplumber.open(str(pdf_path)) as pdf:
        # --- UFs: idhm + 3 subíndices ---
        uf_metric = {}
        for field, caption in UF_TABLE_CAPTIONS.items():
            page_no, table = find_uf_table(pdf, caption)
            uf_metric[field] = parse_uf_table(table)
            print(f"  UF {field:<10} <- p.{page_no}")

        # --- Brasil: idhm + 3 subíndices (T1, ordem: educacao, longevidade, renda, idhm) ---
        p1, t1 = find_brazil_table_lines(pdf, BRAZIL_T1_CAPTION)
        print(f"  BR idhm/subs <- p.{p1}")
        # --- Brasil: IDHMAD (T9, ordem: educacao, longevidade, renda, IDHMAD) ---
        p9, t9 = find_brazil_table_lines(pdf, BRAZIL_T9_CAPTION)
        print(f"  BR adjusted  <- p.{p9}")

    # Monta histórico do Brasil
    brazil_hist = {}
    for year in YEARS:
        educ, longev, income, idhm = t1[year]
        brazil_hist[year] = {
            "idhm": idhm,
            "longevity": longev,
            "education": educ,
            "income": income,
            "adjusted": t9[year][3],  # IDHMAD (4ª coluna)
        }

    # Monta estados
    states = {}
    for code in sorted(UF_CODE_TO_NAME, key=int):
        hist = {}
        for year in YEARS:
            hist[year] = {
                "idhm": uf_metric["idhm"][code][year],
                "longevity": uf_metric["longevity"][code][year],
                "education": uf_metric["education"][code][year],
                "income": uf_metric["income"][code][year],
                "adjusted": None,  # relatório não traz IDHMAD geral por UF
            }
        states[code] = {"id": code, "name": UF_CODE_TO_NAME[code], "history": hist}

    return {
        "source": {
            "label": "PNUD Brasil - Radar IDHM 2026",
            "url": REPORT_URL,
            "localFile": "data/radar_idhm_web.pdf (nao versionado; ver .gitignore)",
            "downloadedAt": date.today().isoformat(),
            "note": ("Serie anual 2012-2024 extraida das tabelas do relatorio Radar IDHM 2026 "
                     "(PNUD, IPEA/FJP, IBGE): IDHM e subindices por UF e Brasil; IDHMAD do Brasil. "
                     f"Baixado de {REPORT_URL}. Gerado por scripts/extract_idhm_from_radar_pdf.py."),
        },
        "latestYear": int(YEARS[-1]),
        "years": YEARS,
        "brazil": {"history": brazil_hist},
        "states": states,
    }


def validate(data: dict) -> None:
    """Confere âncoras oficiais e sanidade. Aborta em qualquer divergência."""
    problems = []

    def check(label, got, expected):
        if got is None or abs(got - expected) > 5e-4:
            problems.append(f"{label}: obtido={got} esperado={expected}")

    for year, fields in ANCHORS_BRAZIL.items():
        for field, expected in fields.items():
            check(f"Brasil {year} {field}", data["brazil"]["history"][year].get(field), expected)
    for code, by_year in ANCHORS_UF.items():
        for year, expected in by_year.items():
            check(f"UF {code} {year} idhm", data["states"][code]["history"][year].get("idhm"), expected)

    # Sanidade: 27 UFs, 13 anos, valores em (0,1]
    if len(data["states"]) != 27:
        problems.append(f"esperava 27 UFs, tem {len(data['states'])}")
    for scope, hist in [("BR", data["brazil"]["history"])] + [
        (c, s["history"]) for c, s in data["states"].items()
    ]:
        if sorted(hist) != sorted(YEARS):
            problems.append(f"{scope}: anos {sorted(hist)} != {YEARS}")
        for year, entry in hist.items():
            for field in ("idhm", "longevity", "education", "income"):
                v = entry.get(field)
                if v is None or not (0 < v <= 1):
                    problems.append(f"{scope} {year} {field}={v} fora de (0,1]")

    if problems:
        print("VALIDAÇÃO FALHOU:")
        for p in problems[:40]:
            print("  -", p)
        raise SystemExit(1)
    print("validação OK (âncoras oficiais conferidas + sanidade).")


def print_summary(data: dict) -> None:
    print("-" * 60)
    print("anos:", ", ".join(data["years"]), "| latestYear:", data["latestYear"])
    br = data["brazil"]["history"]["2024"]
    print(f"Brasil 2024: IDHM={br['idhm']} L={br['longevity']} E={br['education']} "
          f"R={br['income']} IDHMAD={br['adjusted']}")
    sp = data["states"]["35"]["history"]
    print(f"São Paulo: 2012={sp['2012']['idhm']} -> 2024={sp['2024']['idhm']}")
    print("UFs:", len(data["states"]))
    print("-" * 60)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF, help=f"PDF do Radar (padrão: {DEFAULT_PDF}).")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT, help=f"JSON de saída (padrão: {DEFAULT_OUTPUT}).")
    parser.add_argument("--check", action="store_true", help="extrai e valida, mas não escreve.")
    args = parser.parse_args()

    if not args.pdf.exists():
        raise SystemExit(f"PDF não encontrado: {args.pdf}")

    print(f"lendo {args.pdf} ...")
    data = build(args.pdf)
    print_summary(data)
    validate(data)

    if args.check:
        print("--check: nada foi escrito.")
        return
    args.out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"escrito: {args.out}")


if __name__ == "__main__":
    main()
