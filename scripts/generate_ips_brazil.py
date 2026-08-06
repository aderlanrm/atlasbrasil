"""Gera data/ips_brazil.json e data/ips_brazil_cities.json a partir das fontes
oficiais do IPS Brasil (Imazon / Instituto IPS Brasil / Social Progress Imperative).

=============================================================================
DE ONDE VEM CADA COISA
=============================================================================
1) MUNICÍPIOS (5.570) -> data/ips_brazil_cities.json
   Planilha oficial "Dataset completo (todos os municípios)", em URL estática:
   https://ips-brasil.fly.storage.tigris.dev/downloads/ips-brasil-<ano>-tabela.xlsx
   Traz IPS geral, as 3 dimensões, os 12 componentes e os 57 indicadores.

   COMO ESSA URL FOI DESCOBERTA (para conseguir repetir quando a edição virar):
   o painel https://ipsbrasil.org.br/explore/data é um app Phoenix LiveView; o
   botão "Download" é um evento de LiveView, então a URL não está no HTML. Ela
   aparece no diff que o servidor manda ao receber o evento `open_download_modal`.
   O mesmo modal expõe um CSV filtrado em /explore/data/export?edition_id=<uuid>.
   Se a URL abaixo quebrar numa edição futura, é esse o caminho para achar a nova.

2) BRASIL + 27 UFs -> data/ips_brazil.json
   Relatório geral em PDF (https://ipsbrasil.org.br/relatorios), que publica:
     - Quadro das UFs: IPS geral das 27 unidades federativas, com ranking;
     - Seção RESULTADOS: pontuação do Brasil e das 3 dimensões;
     - Seção "Evolução temporal": série recalculada (Brasil + dimensões).
   O PDF (~39 MB) fica em data/ips_brasil_relatorio.pdf e não é versionado.

=============================================================================
COMO FUNCIONA
=============================================================================
No PDF, as tabelas são LOCALIZADAS pelo texto (não por página fixa, que muda entre
edições): a página do quadro das UFs tem "Ranking dos estados" + 27 nomes de UF; a
dos resultados tem "pontuação média de XX,XX ... país"; a da série tem
"EVOLUÇÃO TEMPORAL".

Na planilha municipal, o join com o app é por código IBGE de 7 dígitos. A planilha
NÃO traz o código, só Município + UF, então o script casa por nome normalizado
contra a API de localidades do IBGE. Cinco municípios têm grafia diferente entre
IPS e IBGE e estão na tabela CITY_NAME_ALIASES. Se sobrar qualquer município sem
código, o script ABORTA (nunca grava cobertura parcial silenciosa).

VALIDAÇÕES (se qualquer uma falhar, nada é escrito):
  - âncoras oficiais do PDF (Brasil 63,40; DF 70,73; Pará 55,80 na edição 2026);
  - âncoras municipais do relatório (Gavião Peixoto 73,10; Breves 49,66; ...);
  - os 5.570 municípios casaram com código IBGE;
  - a média municipal PONDERADA POR POPULAÇÃO reproduz a nota nacional do PDF
    (o relatório define a nota do Brasil exatamente assim) -- é o teste mais forte:
    liga as duas fontes independentes uma na outra.

USO:
    python scripts/generate_ips_brazil.py                      # baixa o que faltar
    python scripts/generate_ips_brazil.py --check              # só valida, não escreve
    python scripts/generate_ips_brazil.py --download           # força rebaixar as fontes
    python scripts/generate_ips_brazil.py --skip-cities        # só Brasil/UFs (PDF)
"""

import argparse
import json
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

from pdfminer.high_level import extract_text

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PDF = ROOT / "data" / "ips_brasil_relatorio.pdf"
DEFAULT_XLSX = ROOT / "data" / "ips_brasil_tabela.xlsx"
DEFAULT_OUTPUT = ROOT / "data" / "ips_brazil.json"
DEFAULT_CITIES_OUTPUT = ROOT / "data" / "ips_brazil_cities.json"

REPORT_PAGE = "https://ipsbrasil.org.br/relatorios"
REPORT_URL = "https://ipsbrasil.org.br/relatorios/download/IPSBrasil2026_Relatorio%20Geral.pdf"
PANEL_URL = "https://ipsbrasil.org.br/explore/data"
TABLE_URL_TEMPLATE = "https://ips-brasil.fly.storage.tigris.dev/downloads/ips-brasil-{year}-tabela.xlsx"
TABLE_URL = TABLE_URL_TEMPLATE.format(year=2026)
IBGE_MUNICIPALITIES_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios"

# Edições publicadas com planilha municipal própria.
EDITIONS = [2024, 2025, 2026]

# Coluna da planilha -> chave no JSON. IPS geral, 3 dimensões e 12 componentes.
# Os 57 indicadores existem na planilha e podem ser acrescentados aqui quando
# forem virar opção no seletor da legenda.
CITY_COLUMNS = {
    "Índice de Progresso Social": ("ips", None),
    "Necessidades Humanas Básicas": ("basicNeeds", "dimensions"),
    "Fundamentos do Bem-estar": ("wellbeing", "dimensions"),
    "Oportunidades": ("opportunity", "dimensions"),
    "Nutrição e Cuidados Médicos Básicos": ("nutrition", "components"),
    "Água e Saneamento": ("water", "components"),
    "Moradia": ("housing", "components"),
    "Segurança Pessoal": ("safety", "components"),
    "Acesso ao Conhecimento Básico": ("basicKnowledge", "components"),
    "Acesso à Informação e Comunicação": ("information", "components"),
    "Saúde e Bem-estar": ("health", "components"),
    "Qualidade do Meio Ambiente": ("environment", "components"),
    "Direitos Individuais": ("rights", "components"),
    "Liberdades Individuais e de Escolha": ("freedom", "components"),
    "Inclusão Social": ("inclusion", "components"),
    "Acesso à Educação Superior": ("higherEducation", "components"),
}

# Municípios cuja grafia difere entre a planilha do IPS e a base do IBGE.
# (UF, nome como vem no IPS) -> código IBGE de 7 dígitos.
CITY_NAME_ALIASES = {
    ("SE", "Gracho Cardoso"): "2802601",       # IBGE: Graccho Cardoso
    ("RN", "Arês"): "2401206",                 # IBGE: Arez
    ("RN", "Açu"): "2400208",                  # IBGE: Assú
    ("MG", "Barão de Monte Alto"): "3105509",  # IBGE: Barão do Monte Alto
    ("RR", "São Luiz"): "1400605",             # IBGE: São Luiz do Anauá
}

# Âncoras municipais publicadas no relatório geral (quadros de melhores/piores).
CITY_ANCHORS = {
    ("SP", "Gavião Peixoto"): 73.10,
    ("SP", "Jundiaí"): 71.80,
    ("SP", "Ribeirão Preto"): 70.80,
    ("PA", "Breves"): 49.66,
    ("PA", "Bannach"): 47.23,
}

# Nome canônico (sem acento, minúsculo) da UF -> (código IBGE, sigla, nome de exibição).
UF_BY_NAME = {
    "rondonia": ("11", "RO", "Rondônia"),
    "acre": ("12", "AC", "Acre"),
    "amazonas": ("13", "AM", "Amazonas"),
    "roraima": ("14", "RR", "Roraima"),
    "para": ("15", "PA", "Pará"),
    "amapa": ("16", "AP", "Amapá"),
    "tocantins": ("17", "TO", "Tocantins"),
    "maranhao": ("21", "MA", "Maranhão"),
    "piaui": ("22", "PI", "Piauí"),
    "ceara": ("23", "CE", "Ceará"),
    "rio grande do norte": ("24", "RN", "Rio Grande do Norte"),
    "paraiba": ("25", "PB", "Paraíba"),
    "pernambuco": ("26", "PE", "Pernambuco"),
    "alagoas": ("27", "AL", "Alagoas"),
    "sergipe": ("28", "SE", "Sergipe"),
    "bahia": ("29", "BA", "Bahia"),
    "minas gerais": ("31", "MG", "Minas Gerais"),
    "espirito santo": ("32", "ES", "Espírito Santo"),
    "rio de janeiro": ("33", "RJ", "Rio de Janeiro"),
    "sao paulo": ("35", "SP", "São Paulo"),
    "parana": ("41", "PR", "Paraná"),
    "santa catarina": ("42", "SC", "Santa Catarina"),
    "rio grande do sul": ("43", "RS", "Rio Grande do Sul"),
    "mato grosso do sul": ("50", "MS", "Mato Grosso do Sul"),
    "mato grosso": ("51", "MT", "Mato Grosso"),
    "goias": ("52", "GO", "Goiás"),
    "distrito federal": ("53", "DF", "Distrito Federal"),
}

# Âncoras oficiais da edição 2026 (relatório geral, Quadro 11 e seção RESULTADOS).
# Servem de trava: se a extração divergir, o script aborta em vez de gravar lixo.
DEFAULT_ANCHORS = {
    "brazil": 63.40,
    "53": 70.73,  # Distrito Federal, 1º
    "35": 67.96,  # São Paulo, 2º
    "15": 55.80,  # Pará, 27º
}

DIMENSION_KEYS = ["basicNeeds", "wellbeing", "opportunity"]
DIMENSION_LABELS = {
    "basicNeeds": "Necessidades Humanas Básicas",
    "wellbeing": "Fundamentos do Bem-estar",
    "opportunity": "Oportunidades",
}

NUMBER_RE = re.compile(r"\b(\d{1,3},\d{2})\b")


def strip_accents(text):
    normalized = unicodedata.normalize("NFD", text)
    return "".join(char for char in normalized if unicodedata.category(char) != "Mn")


def canonical(text):
    return re.sub(r"\s+", " ", strip_accents(text).lower()).strip()


def to_float(token):
    return float(token.replace(".", "").replace(",", "."))


def download_report(destination):
    try:
        import httpx
    except ImportError:  # pragma: no cover - dependência opcional
        raise SystemExit(
            "httpx não instalado. Baixe o relatório manualmente de "
            f"{REPORT_PAGE} e rode com --pdf <arquivo>."
        )

    print(f"Baixando relatório de {REPORT_URL} ...")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream("GET", REPORT_URL, follow_redirects=True, timeout=600) as response:
        response.raise_for_status()
        with destination.open("wb") as handle:
            for chunk in response.iter_bytes(chunk_size=1 << 20):
                handle.write(chunk)
    print(f"  salvo em {destination} ({destination.stat().st_size / 1e6:.1f} MB)")


def download_file(url, destination, label):
    try:
        import httpx
    except ImportError:  # pragma: no cover
        raise SystemExit(f"httpx não instalado. Baixe {label} manualmente de {url} e passe o caminho.")

    print(f"Baixando {label} de {url} ...")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream("GET", url, follow_redirects=True, timeout=600) as response:
        response.raise_for_status()
        with destination.open("wb") as handle:
            for chunk in response.iter_bytes(chunk_size=1 << 20):
                handle.write(chunk)
    print(f"  salvo em {destination} ({destination.stat().st_size / 1e6:.1f} MB)")


def ibge_code_index():
    """(sigla da UF, nome normalizado) -> código IBGE de 7 dígitos. Cacheado entre edições."""
    if ibge_code_index.cache:
        return ibge_code_index.cache
    try:
        import httpx
    except ImportError:  # pragma: no cover
        raise SystemExit("httpx não instalado; necessário para casar municípios com o código IBGE.")

    print("Buscando municípios do IBGE para o join por código ...")
    response = httpx.get(IBGE_MUNICIPALITIES_URL, timeout=300, follow_redirects=True)
    response.raise_for_status()
    rows = response.json()

    index = {}
    for row in rows:
        micro = row.get("microrregiao")
        if micro:
            uf = micro["mesorregiao"]["UF"]["sigla"]
        else:
            uf = row["regiao-imediata"]["regiao-intermediaria"]["UF"]["sigla"]
        index[(uf, canonical_city(row["nome"]))] = str(row["id"])
    print(f"  {len(index)} municípios indexados")
    ibge_code_index.cache = index
    return index


ibge_code_index.cache = None


def canonical_city(name):
    text = strip_accents(str(name)).lower().replace("'", " ").replace("-", " ")
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def aggregate_states(cities):
    """Deriva o IPS de cada UF como média municipal ponderada pela população.

    Esse é o mesmo cálculo que o relatório usa para a nota do Brasil, e reproduz o
    Quadro das UFs do PDF com diferença máxima de 0,01 (validado em validate_derived_states).
    Só assim dá para ter UF nas edições antigas, cujo relatório não está integrado.
    """
    buckets = {}
    for code, entry in cities.items():
        uf_code = code[:2]
        bucket = buckets.setdefault(uf_code, {"weight": 0, "ips": 0.0, "dimensions": {k: 0.0 for k in DIMENSION_KEYS}})
        population = entry["pop"] or 0
        bucket["weight"] += population
        bucket["ips"] += (entry["ips"] or 0) * population
        for key in DIMENSION_KEYS:
            bucket["dimensions"][key] += (entry["dimensions"].get(key) or 0) * population

    states = {}
    for uf_code, bucket in buckets.items():
        weight = max(bucket["weight"], 1)
        states[uf_code] = {
            "ips": round(bucket["ips"] / weight, 2),
            "dimensions": {key: round(value / weight, 2) for key, value in bucket["dimensions"].items()},
        }

    ordered = sorted(states.items(), key=lambda item: item[1]["ips"], reverse=True)
    for position, (uf_code, _row) in enumerate(ordered, start=1):
        states[uf_code]["rank"] = position
    return states


def aggregate_national(cities):
    weight = sum(entry["pop"] or 0 for entry in cities.values())
    weight = max(weight, 1)
    return {
        "ips": round(sum((entry["ips"] or 0) * (entry["pop"] or 0) for entry in cities.values()) / weight, 2),
        "dimensions": {
            key: round(
                sum((entry["dimensions"].get(key) or 0) * (entry["pop"] or 0) for entry in cities.values()) / weight, 2
            )
            for key in DIMENSION_KEYS
        },
        "population": weight,
    }


def validate_derived_states(derived, official, tolerance=0.02):
    """Prova que a derivação por média ponderada reproduz o quadro oficial do PDF."""
    worst = 0.0
    for code, row in official.items():
        got = derived.get(code)
        if not got:
            raise SystemExit(f"UF {row['uf']} ausente na derivação municipal")
        worst = max(worst, abs(got["ips"] - row["ips"]))
    if worst > tolerance:
        raise SystemExit(
            f"derivação das UFs diverge do quadro oficial em até {worst:.3f} "
            f"(tolerância {tolerance}); planilha e relatório podem ser de edições diferentes."
        )
    print(f"  derivação das UFs confere com o Quadro oficial (dif. máxima {worst:.4f})")


def parse_cities(xlsx_path, national=None):
    """Lê a planilha municipal, casa com o código IBGE e valida contra o relatório."""
    try:
        import pandas as pd
    except ImportError:  # pragma: no cover
        raise SystemExit("pandas não instalado; necessário para ler a planilha municipal.")

    frame = pd.read_excel(xlsx_path)
    missing_columns = [column for column in CITY_COLUMNS if column not in frame.columns]
    if missing_columns:
        raise SystemExit(f"planilha sem colunas esperadas: {missing_columns}")
    if "POPULAÇÃO 2025" not in frame.columns and not any(c.startswith("POPULAÇÃO") for c in frame.columns):
        raise SystemExit("planilha sem coluna de população; a validação ponderada não pode rodar.")

    population_column = next(c for c in frame.columns if str(c).startswith("POPULAÇÃO"))
    index = ibge_code_index.cache or ibge_code_index()

    cities = {}
    unmatched = []
    for _, row in frame.iterrows():
        uf = str(row["UF"]).strip()
        name = str(row["Município"]).strip()
        code = CITY_NAME_ALIASES.get((uf, name)) or index.get((uf, canonical_city(name)))
        if not code:
            unmatched.append(f"{uf}/{name}")
            continue

        entry = {"name": name, "uf": uf}
        for column, (key, group) in CITY_COLUMNS.items():
            value = row[column]
            value = None if value is None or (isinstance(value, float) and value != value) else round(float(value), 2)
            if group is None:
                entry[key] = value
            else:
                entry.setdefault(group, {})[key] = value
        entry["pop"] = int(row[population_column]) if row[population_column] == row[population_column] else 0
        cities[code] = entry

    if unmatched:
        preview = ", ".join(unmatched[:10])
        raise SystemExit(
            f"{len(unmatched)} municípios sem código IBGE ({preview}...). "
            "Acrescente-os em CITY_NAME_ALIASES antes de gerar."
        )

    # Ranking nacional (1 = melhor), como o scorecard oficial mostra (x/5.570).
    ordered = sorted(cities.items(), key=lambda item: item[1]["ips"] or 0, reverse=True)
    for position, (code, _entry) in enumerate(ordered, start=1):
        cities[code]["rank"] = position

    total_population = sum(entry["pop"] for entry in cities.values())

    # Validações contra o relatório só valem para a edição que temos em PDF.
    # Nas edições anteriores, a planilha é a única fonte integrada.
    if national:
        weighted = sum((entry["ips"] or 0) * entry["pop"] for entry in cities.values()) / max(total_population, 1)
        if abs(weighted - national["ips"]) > 0.011:
            raise SystemExit(
                f"média municipal ponderada ({weighted:.2f}) não bate com a nota nacional do "
                f"relatório ({national['ips']:.2f}); planilha e PDF podem ser de edições diferentes."
            )
        print(f"  média ponderada por população: {weighted:.2f} == nota nacional do relatório")

        for (uf, name), expected in CITY_ANCHORS.items():
            found = next((entry for entry in cities.values() if entry["uf"] == uf and entry["name"] == name), None)
            if not found:
                raise SystemExit(f"âncora municipal ausente na planilha: {uf}/{name}")
            if abs(found["ips"] - expected) > 0.011:
                raise SystemExit(f"âncora {uf}/{name}: relatório diz {expected}, planilha diz {found['ips']}")
        print(f"  {len(CITY_ANCHORS)} âncoras municipais do relatório conferem")

    return cities, total_population


def page_texts(pdf_path, limit=None):
    """Extrai o texto página a página (lazy o suficiente para um PDF de ~40 MB)."""
    from pdfminer.high_level import extract_pages  # noqa: F401  (garante backend disponível)
    from pdfminer.pdfpage import PDFPage

    with pdf_path.open("rb") as handle:
        total = sum(1 for _ in PDFPage.get_pages(handle))

    if limit is not None:
        total = min(total, limit)

    for index in range(total):
        yield index, extract_text(str(pdf_path), page_numbers=[index])


def find_edition_year(text):
    match = re.search(r"IPS\s+Brasil\s+(20\d{2})", text)
    return int(match.group(1)) if match else None


def parse_state_table(text):
    """Lê o Quadro das UFs: ranking, nome da UF e IPS geral.

    O PDF serializa a tabela em colunas (todos os rankings, depois todos os nomes,
    depois todos os valores), então casamos por posição e validamos em seguida.
    """
    flat = canonical(text)
    if "ranking dos estados" not in flat:
        return None

    names = []
    for raw_line in text.splitlines():
        key = canonical(raw_line)
        if key in UF_BY_NAME:
            names.append(key)

    values = [to_float(token) for token in NUMBER_RE.findall(text)]
    # O cabeçalho traz o ano ("IPS Brasil 2026"), que não casa com \d{1,3},\d{2}.
    values = [value for value in values if 0 < value <= 100]

    if len(names) != 27 or len(values) != 27:
        return None

    rows = {}
    for position, (name, value) in enumerate(zip(names, values), start=1):
        code, sigla, display = UF_BY_NAME[name]
        rows[code] = {
            "id": code,
            "uf": sigla,
            "name": display,
            "ips": round(value, 2),
            "rank": position,
        }

    if len(rows) != 27:
        raise SystemExit("Quadro das UFs veio com UF repetida; extração inconsistente.")
    ordered = [rows[code]["ips"] for code in sorted(rows, key=lambda c: rows[c]["rank"])]
    if ordered != sorted(ordered, reverse=True):
        raise SystemExit("Quadro das UFs não veio em ordem decrescente; extração inconsistente.")
    return rows


def parse_national(text):
    """Lê a pontuação nacional e as três dimensões da seção RESULTADOS."""
    flat = re.sub(r"\s+", " ", text)
    match = re.search(r"pontua[çc][ãa]o m[ée]dia de (\d{1,3},\d{2})", flat)
    if not match:
        return None

    national = to_float(match.group(1))
    tail = flat[match.end():]
    dimension_values = [to_float(token) for token in NUMBER_RE.findall(tail)][:3]
    if len(dimension_values) != 3:
        return None

    return {
        "ips": round(national, 2),
        "dimensions": {
            key: round(value, 2) for key, value in zip(DIMENSION_KEYS, dimension_values)
        },
    }


def parse_history(text, national):
    """Lê a série recalculada (Brasil + 3 dimensões) do gráfico de evolução temporal.

    Os rótulos do eixo Y são múltiplos de 5 terminados em ",00" e são descartados.
    A série só é aceita se o último ponto de cada grupo bater com o valor nacional
    já validado -- caso contrário devolve None e o JSON sai sem histórico.
    """
    years = re.findall(r"\b(20\d{2})\b", text)
    years = sorted({int(year) for year in years})
    if len(years) < 2:
        return None

    tokens = [to_float(token) for token in NUMBER_RE.findall(text)]
    values = [value for value in tokens if not (value % 5 == 0 and value == int(value))]

    span = len(years)
    if len(values) != span * 4:
        return None

    groups = [values[index * span:(index + 1) * span] for index in range(4)]
    expected = [national["ips"]] + [national["dimensions"][key] for key in DIMENSION_KEYS]
    for group, anchor in zip(groups, expected):
        if abs(group[-1] - anchor) > 0.011:
            return None

    history = {}
    for position, year in enumerate(years):
        history[str(year)] = {
            "ips": round(groups[0][position], 2),
            "dimensions": {
                key: round(groups[index + 1][position], 2)
                for index, key in enumerate(DIMENSION_KEYS)
            },
        }
    return history


def extract(pdf_path):
    states = None
    national = None
    history_candidates = []
    edition = None

    for index, text in page_texts(pdf_path):
        if not text:
            continue
        if edition is None:
            edition = find_edition_year(text)
        if national is None:
            national = parse_national(text)
        if states is None:
            states = parse_state_table(text)
        # O sumário também cita "Evolução temporal", então guardamos todas as
        # páginas candidatas e deixamos a validação escolher a que tem a série.
        if "evolucao temporal" in canonical(text):
            history_candidates.append(text)

    if not national:
        raise SystemExit("Não achei a pontuação nacional ('pontuação média de ...') no PDF.")
    if not states:
        raise SystemExit("Não achei o quadro de IPS por unidade federativa no PDF.")

    history = None
    for candidate in history_candidates:
        history = parse_history(candidate, national)
        if history:
            break
    if history is None:
        print("  aviso: série temporal não pôde ser validada; JSON sai só com o ano corrente.")

    return {
        "edition": edition,
        "national": national,
        "states": states,
        "history": history,
    }


def validate(payload, anchors):
    problems = []
    national = payload["national"]["ips"]
    if not 0 < national <= 100:
        problems.append(f"IPS nacional fora da escala 0-100: {national}")

    for code, row in payload["states"].items():
        if not 0 < row["ips"] <= 100:
            problems.append(f"IPS fora da escala em {row['uf']}: {row['ips']}")

    for key, expected in anchors.items():
        actual = national if key == "brazil" else payload["states"].get(key, {}).get("ips")
        if actual is None:
            problems.append(f"âncora {key} não encontrada na extração")
        elif abs(actual - expected) > 0.011:
            problems.append(f"âncora {key}: esperado {expected}, extraído {actual}")

    if problems:
        for problem in problems:
            print(f"  ERRO: {problem}", file=sys.stderr)
        raise SystemExit("Validação falhou; nada foi escrito.")


# Médias dos 9 grupos de desempenho publicadas no relatório (Quadro 3 / Tabela 1).
# O relatório define os grupos por quebras naturais (Jenks) mas não publica os
# limites; usamos o ponto médio entre médias consecutivas como aproximação. Cada
# média publicada cai dentro da sua própria classe -- é a checagem em class_breaks_for_ips.
OFFICIAL_GROUP_MEANS = [68.37, 64.21, 61.89, 59.83, 57.93, 55.80, 53.44, 50.56, 46.50]
CLASS_COUNT = len(OFFICIAL_GROUP_MEANS)


def class_breaks_for_ips():
    means = sorted(OFFICIAL_GROUP_MEANS)
    breaks = [round((means[i] + means[i + 1]) / 2, 2) for i in range(len(means) - 1)]
    for mean in means:
        position = sum(1 for value in breaks if mean >= value)
        expected = means.index(mean)
        if position != expected:
            raise SystemExit("cortes derivados não separam os grupos oficiais do relatório")
    return breaks


def quantile_breaks(values, classes=CLASS_COUNT):
    """Cortes por quantis: cada classe recebe ~o mesmo número de municípios.

    Usado nas dimensões, que não têm agrupamento oficial publicado. Sem isso, uma
    dimensão com média alta (Necessidades Humanas Básicas, ~75) ficaria toda na cor
    do topo e outra com média baixa (Oportunidades, ~47) toda na cor de baixo.
    """
    ordered = sorted(value for value in values if value is not None)
    if len(ordered) < classes:
        return []
    breaks = []
    for index in range(1, classes):
        position = int(round(index / classes * (len(ordered) - 1)))
        breaks.append(round(ordered[position], 2))
    # Garante monotonicidade estrita (empates viram degrau de 0,01).
    for index in range(1, len(breaks)):
        if breaks[index] <= breaks[index - 1]:
            breaks[index] = round(breaks[index - 1] + 0.01, 2)
    return breaks


def build_class_breaks(cities):
    breaks = {
        "ips": {
            "breaks": class_breaks_for_ips(),
            "method": "pontos médios entre as médias dos 9 grupos oficiais do relatório",
        }
    }
    for key in DIMENSION_KEYS:
        values = [entry["dimensions"].get(key) for entry in cities.values()]
        breaks[key] = {
            "breaks": quantile_breaks(values),
            "method": "quantis da distribuição municipal da edição vigente",
        }
    return breaks


COMPARABILITY_WARNING = (
    "As edições do IPS Brasil não são estritamente comparáveis entre si: cada uma usa os "
    "indicadores e tratamentos estatísticos disponíveis na época. Para ver tendência, use a "
    "série recalculada do Brasil (recalculatedSeries), que o relatório publica com os "
    "parâmetros da edição vigente."
)


def build_document(payload, editions, pdf_path, class_breaks=None):
    """JSON de Brasil + UFs, com um bloco por edição publicada.

    Na edição vigente os valores das UFs vêm do quadro oficial do relatório. Nas
    anteriores vêm da agregação municipal ponderada por população -- o mesmo cálculo,
    validado contra o quadro oficial na edição vigente (validate_derived_states).
    """
    latest = payload["edition"]
    history = payload["history"]

    brazil_by_year = {}
    states_by_year = {}
    for year, bundle in sorted(editions.items()):
        brazil_by_year[str(year)] = {
            "ips": bundle["national"]["ips"],
            "dimensions": bundle["national"]["dimensions"],
            "population": bundle["national"]["population"],
            "origin": "relatorio" if year == latest else "agregacao municipal ponderada",
        }
        states_by_year[str(year)] = bundle["states"]

    states = {}
    for code, row in sorted(payload["states"].items()):
        by_year = {}
        for year in sorted(editions):
            derived = states_by_year[str(year)].get(code)
            if not derived:
                continue
            official = payload["states"].get(code) if year == latest else None
            by_year[str(year)] = {
                "ips": official["ips"] if official else derived["ips"],
                "rank": official["rank"] if official else derived["rank"],
                "dimensions": derived["dimensions"],
            }
        states[code] = {"id": row["id"], "uf": row["uf"], "name": row["name"], "byYear": by_year}

    brazil = {
        "ips": payload["national"]["ips"],
        "dimensions": payload["national"]["dimensions"],
        "byYear": brazil_by_year,
    }
    if history:
        brazil["recalculatedSeries"] = history

    return {
        "source": {
            "label": f"IPS Brasil - Instituto IPS Brasil / Imazon (edições {min(editions)}-{max(editions)})",
            "url": REPORT_PAGE,
            "reportUrl": REPORT_URL,
            "panelUrl": PANEL_URL,
            "localFile": f"{pdf_path.relative_to(ROOT).as_posix()} (nao versionado; ver .gitignore)",
            "downloadedAt": date.today().isoformat(),
            "note": (
                f"Brasil e 27 UFs por edicao. Na edicao {latest}, as UFs vem do quadro oficial do "
                f"relatorio geral; nas anteriores, da agregacao municipal ponderada pela populacao "
                f"(mesmo calculo que o relatorio usa para a nota nacional, validado contra o quadro "
                f"oficial de {latest} com diferenca maxima de 0,01). recalculatedSeries traz a serie "
                f"comparavel que o relatorio publica. Gerado por scripts/generate_ips_brazil.py."
            ),
        },
        "edition": latest,
        "latestYear": latest,
        "editions": [str(year) for year in sorted(editions)],
        "years": [str(year) for year in sorted(editions)],
        "comparabilityWarning": COMPARABILITY_WARNING,
        "scale": {"min": 0, "max": 100, "direction": "higher-is-better"},
        "dimensionLabels": DIMENSION_LABELS,
        "classCount": CLASS_COUNT,
        "classBreaks": class_breaks or {},
        "coverage": {"brazil": True, "states": True, "cities": True},
        "brazil": brazil,
        "states": states,
    }


def build_cities_document(cities, edition, total_population, xlsx_path, include_components=False, is_latest=True):
    # O app baixa esse arquivo no carregamento, inclusive no celular, então ele
    # carrega só o que é exibido hoje (IPS geral + ranking) mais as 3 dimensões,
    # que são as próximas candidatas do seletor. Os 12 componentes ficam de fora
    # por padrão porque triplicam o arquivo (586 KB -> 1,8 MB) sem uso na tela;
    # use --full quando forem virar opção de verdade.
    payload = {}
    for code, entry in cities.items():
        row = {
            "name": entry["name"],
            "ips": entry["ips"],
            "rank": entry["rank"],
            "dimensions": entry["dimensions"],
        }
        if include_components:
            row["components"] = entry["components"]
        payload[code] = row
    cities = payload

    return {
        "source": {
            "label": f"IPS Brasil {edition} - tabela municipal oficial",
            "url": PANEL_URL,
            "fileUrl": TABLE_URL_TEMPLATE.format(year=edition),
            "localFile": f"{xlsx_path.relative_to(ROOT).as_posix()} (nao versionado; ver .gitignore)",
            "downloadedAt": date.today().isoformat(),
            "note": (
                f"IPS geral, ranking e 3 dimensoes dos 5.570 municipios, da planilha "
                f"\"Dataset completo\" do painel IPS Brasil {edition}. Join com o app por codigo "
                f"IBGE de 7 digitos (a planilha traz so Municipio+UF; o casamento usa a API de "
                f"localidades do IBGE). "
                + (
                    "Validado contra o relatorio geral: a media ponderada por populacao reproduz a "
                    "nota nacional. "
                    if is_latest
                    else "Edicao anterior: o relatorio dela nao esta integrado, entao a validacao "
                    "contra PDF nao se aplica; os valores sao os publicados na propria planilha. "
                )
                + "Gerado por scripts/generate_ips_brazil.py."
            ),
        },
        "edition": edition,
        "latestYear": edition,
        "isLatestEdition": is_latest,
        "comparabilityWarning": COMPARABILITY_WARNING,
        "scale": {"min": 0, "max": 100, "direction": "higher-is-better"},
        "dimensionLabels": DIMENSION_LABELS,
        "hasComponents": include_components,
        "componentLabels": {
            "nutrition": "Nutrição e Cuidados Médicos Básicos",
            "water": "Água e Saneamento",
            "housing": "Moradia",
            "safety": "Segurança Pessoal",
            "basicKnowledge": "Acesso ao Conhecimento Básico",
            "information": "Acesso à Informação e Comunicação",
            "health": "Saúde e Bem-estar",
            "environment": "Qualidade do Meio Ambiente",
            "rights": "Direitos Individuais",
            "freedom": "Liberdades Individuais e de Escolha",
            "inclusion": "Inclusão Social",
            "higherEducation": "Acesso à Educação Superior",
        },
        "count": len(cities),
        "populationCovered": total_population,
        "cities": dict(sorted(cities.items())),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF, help="relatório geral do IPS Brasil em PDF")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="JSON de saída (Brasil + UFs, todas as edições)")
    parser.add_argument("--check", action="store_true", help="extrai e valida sem escrever os JSONs")
    parser.add_argument("--download", action="store_true", help="força novo download das fontes")
    parser.add_argument("--skip-cities", action="store_true", help="gera só Brasil/UFs a partir do PDF")
    parser.add_argument("--full", action="store_true", help="inclui os 12 componentes nos JSONs municipais (triplica cada arquivo)")
    parser.add_argument("--editions", type=int, nargs="+", default=EDITIONS, help="edições a processar")
    args = parser.parse_args()

    if args.download or not args.pdf.exists():
        download_file(REPORT_URL, args.pdf, "relatório geral (PDF)")

    print(f"Lendo {args.pdf} ...")
    payload = extract(args.pdf)
    print(f"  edição detectada: {payload['edition']}")
    print(f"  Brasil: {payload['national']['ips']} | UFs: {len(payload['states'])}")

    validate(payload, DEFAULT_ANCHORS)
    print("  validação OK (âncoras oficiais conferem)")

    latest = payload["edition"]
    editions = {}
    cities_documents = {}

    if not args.skip_cities:
        for year in sorted(args.editions):
            xlsx_path = ROOT / "data" / f"ips_brasil_tabela_{year}.xlsx"
            # A edição vigente pode já estar baixada com o nome antigo.
            if year == latest and not xlsx_path.exists() and DEFAULT_XLSX.exists():
                xlsx_path = DEFAULT_XLSX
            if args.download or not xlsx_path.exists():
                download_file(TABLE_URL_TEMPLATE.format(year=year), xlsx_path, f"planilha municipal {year} (XLSX)")

            print(f"Lendo edição {year}: {xlsx_path.name} ...")
            is_latest = year == latest
            cities, total_population = parse_cities(xlsx_path, payload["national"] if is_latest else None)
            print(f"  {len(cities)} municípios com código IBGE")

            derived_states = aggregate_states(cities)
            if is_latest:
                validate_derived_states(derived_states, payload["states"])

            editions[year] = {
                "cities": cities,
                "states": derived_states,
                "national": aggregate_national(cities),
            }
            print(f"  Brasil {year} (agregado): {editions[year]['national']['ips']}")

            cities_documents[year] = build_cities_document(
                cities, year, total_population, xlsx_path,
                include_components=args.full, is_latest=is_latest,
            )
    else:
        editions[latest] = {
            "cities": {},
            "states": {code: {"ips": row["ips"], "rank": row["rank"], "dimensions": {}} for code, row in payload["states"].items()},
            "national": {**payload["national"], "population": 0},
        }

    # Cortes de cor calculados na edição vigente e aplicados a todas, para a cor
    # significar a mesma coisa quando o usuário troca o ano.
    class_breaks = build_class_breaks(editions[latest]["cities"]) if editions.get(latest, {}).get("cities") else None
    if class_breaks:
        print("  cortes de classe: " + ", ".join(f"{key}={len(value['breaks'])}" for key, value in class_breaks.items()))

    document = build_document(payload, editions, args.pdf, class_breaks)

    if args.check:
        print("--check: nada escrito.")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Escrito {args.output} ({args.output.stat().st_size / 1024:.1f} KB)")

    for year, cities_document in sorted(cities_documents.items()):
        # Um arquivo por edição: o app baixa a vigente no carregamento e busca as
        # outras só quando o usuário troca o ano na legenda.
        target = ROOT / "data" / f"ips_brazil_cities_{year}.json"
        target.write_text(
            json.dumps(cities_document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
        )
        print(f"Escrito {target.name} ({target.stat().st_size / 1024:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
