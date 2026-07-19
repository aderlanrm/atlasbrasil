#!/usr/bin/env python3
"""
Coleta o material-fonte para as "Histórias de Cidades" do Atlas Brasil.

Para cada município da lista TEST_CITIES, busca nas APIs do IBGE:
  - População 2022, área e densidade (SIDRA 4714)
  - População 2000 e 2010 (SIDRA 200, censos)
  - PIB total do último ano oficial (SIDRA 5938, v.37)
  - Composição do VAB (agro/indústria/serviços/adm. pública) do último ano
    publicado no nível municipal (SIDRA 5938; hoje 2021 — 2022+ vêm como "...")
  - Ranking populacional na UF e PIB per capita mediano da UF (calculados
    a partir das bases completas de municípios)
  - Histórico oficial do IBGE Cidades (API biblioteca)
  - IDHM da UF (proxy estadual, data/idhm_brazil.json) — claramente rotulado

Saídas:
  --material <path> : JSON com o material-fonte por cidade (auditoria/pipeline)
  --prompts <dir>   : um .txt por cidade com o prompt-mestre preenchido,
                      pronto para enviar a um LLM (escala futura)

As histórias em si NÃO são geradas aqui: o material alimenta o prompt-mestre
(prompt-mestre-atlas-cidades.md) e o resultado revisado é salvo em
data/stories_brazil_cities.json.

Uso:
  python scripts/generate_city_stories.py --material scratch/stories_material.json
"""

import argparse
import gzip
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.request

SIDRA = "https://apisidra.ibge.gov.br/values"
LOCALIDADES = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome"
BIBLIOTECA = "https://servicodados.ibge.gov.br/api/v1/biblioteca?aspas=3&codmun={code}"

PIB_YEAR = "2023"          # último PIB municipal oficial (alinhar com LATEST_OFFICIAL_GDP_YEAR do app.js)
VAB_YEARS = ["2023", "2022", "2021"]  # tenta do mais novo para o mais antigo

# 10 cidades-teste, escolhidas para cobrir arquétipos diferentes da paleta
TEST_CITIES = [
    "3125101",  # Extrema - MG (logística na divisa SP/MG)
    "5107925",  # Sorriso - MT (fronteira agrícola)
    "3204302",  # Presidente Kennedy - ES (royalties de petróleo)
    "3146107",  # Ouro Preto - MG (ciclo do ouro, mineração)
    "3510609",  # Carapicuíba - SP (dormitório da metrópole)
    "4205407",  # Florianópolis - SC (capital, serviços e turismo)
    "2504009",  # Campina Grande - PB (polo regional)
    "2204550",  # Guaribas - PI (economia da prefeitura)
    "4300646",  # Ametista do Sul - RS (mineração de ametista; tem documentário na aba Viajando)
    "3536505",  # Paulínia - SP (refinaria/empresa-cidade)
]


def fetch_json(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "atlas-brasil-stories/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                if raw[:2] == b"\x1f\x8b":
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8"))
        except Exception as exc:
            if attempt == retries - 1:
                raise
            print(f"  retry {attempt + 1} apos erro: {exc}")
            time.sleep(2 * (attempt + 1))


def sidra_value(row):
    value = row.get("V")
    if value in (None, "...", "-", ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def fetch_city_index():
    """Mapa código -> nome/UF/mesorregião a partir da API de localidades."""
    data = fetch_json(LOCALIDADES)
    index = {}
    for item in data:
        meso = (item.get("microrregiao") or {}).get("mesorregiao") or {}
        uf = meso.get("UF") or {}
        index[str(item["id"])] = {
            "name": item["nome"],
            "uf": uf.get("sigla", ""),
            "stateId": str(uf.get("id", "")),
            "stateName": uf.get("nome", ""),
            "meso": meso.get("nome", ""),
        }
    return index


def fetch_all_population():
    """População 2022 + área de todos os municípios (para ranking e densidade)."""
    rows = fetch_json(f"{SIDRA}/t/4714/n6/all/v/93,6318/p/2022")
    pop, area = {}, {}
    for row in rows[1:]:
        code = str(row.get("D1C", ""))
        value = sidra_value(row)
        if value is None:
            continue
        if row.get("D2C") == "93":
            pop[code] = int(value)
        elif row.get("D2C") == "6318":
            area[code] = value
    return pop, area


def fetch_all_gdp():
    """PIB total (mil R$) de todos os municípios no último ano oficial."""
    rows = fetch_json(f"{SIDRA}/t/5938/n6/all/v/37/p/{PIB_YEAR}")
    gdp = {}
    for row in rows[1:]:
        value = sidra_value(row)
        if value is not None:
            gdp[str(row.get("D1C", ""))] = value * 1000  # mil R$ -> R$
    return gdp


def fetch_census_history(code):
    """População dos censos 2000 e 2010 (somente linhas de total)."""
    rows = fetch_json(f"{SIDRA}/t/200/n6/{code}/v/93/p/2000,2010")
    result = {}
    for row in rows[1:]:
        if row.get("D4C") == "0" and row.get("D5C") == "0" and row.get("D6C") == "0":
            value = sidra_value(row)
            if value is not None:
                result[row.get("D3C")] = int(value)
    return result


def fetch_vab(code):
    """Composição do VAB do último ano municipal publicado."""
    labels = {"513": "agro", "517": "industria", "6575": "servicos", "525": "admPublica"}
    years = ",".join(VAB_YEARS)
    rows = fetch_json(f"{SIDRA}/t/5938/n6/{code}/v/513,517,6575,525/p/{years}")
    by_year = {}
    for row in rows[1:]:
        key = labels.get(row.get("D2C"))
        value = sidra_value(row)
        if key and value is not None:
            by_year.setdefault(row.get("D3C"), {})[key] = value * 1000
    for year in VAB_YEARS:  # mais novo primeiro
        entry = by_year.get(year)
        if entry and len(entry) == 4:
            total = sum(entry.values())
            pct = {k: round(100 * v / total, 1) for k, v in entry.items()} if total else {}
            return {"year": year, "values": entry, "pct": pct}
    return None


def fetch_historico(code):
    """Texto histórico oficial do IBGE Cidades (limpo de HTML/whitespace)."""
    try:
        data = fetch_json(BIBLIOTECA.format(code=code))
    except Exception as exc:
        print(f"  historico indisponivel: {exc}")
        return None
    entry = data.get(str(code)) or next(iter(data.values()), None)
    if not entry:
        return None
    text = entry.get("HISTORICO") or ""
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    text = re.sub(r"[ \t]+", " ", text.replace("\r", "\n"))
    text = re.sub(r"\n{2,}", "\n", text).strip()
    return {"text": text, "year": entry.get("ANO", ""), "source": "IBGE Cidades / Enciclopédia dos Municípios"}


def load_idhm_states(repo_root):
    path = os.path.join(repo_root, "data", "idhm_brazil.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    latest = str(data.get("latestYear", ""))
    result = {}
    for state_id, state in (data.get("states") or {}).items():
        entry = (state.get("history") or {}).get(latest) or {}
        if entry.get("idhm"):
            result[str(state_id)] = {"idhm": entry["idhm"], "year": latest}
    return result


def build_material(repo_root, codes=None):
    codes = codes if codes is not None else TEST_CITIES
    print("Baixando indice de municipios...")
    index = fetch_city_index()
    print("Baixando populacao/area de todos os municipios (SIDRA 4714)...")
    pop_all, area_all = fetch_all_population()
    print("Baixando PIB de todos os municipios (SIDRA 5938)...")
    gdp_all = fetch_all_gdp()
    idhm_states = load_idhm_states(repo_root)

    # ranking populacional e mediana do PIB per capita por UF
    by_state_pop = {}
    by_state_pc = {}
    for code, pop in pop_all.items():
        state_id = code[:2]
        by_state_pop.setdefault(state_id, []).append((code, pop))
        gdp = gdp_all.get(code)
        if gdp and pop:
            by_state_pc.setdefault(state_id, []).append(gdp / pop)
    rank_in_state = {}
    for state_id, items in by_state_pop.items():
        items.sort(key=lambda pair: pair[1], reverse=True)
        for position, (code, _) in enumerate(items, start=1):
            rank_in_state[code] = position
    median_pc = {}
    for state_id, values in by_state_pc.items():
        values.sort()
        middle = len(values) // 2
        median_pc[state_id] = values[middle] if len(values) % 2 else (values[middle - 1] + values[middle]) / 2

    if codes == "ALL_IN_INDEX":
        codes = sorted(index.keys())

    cities = {}
    for code in codes:
        info = index.get(code)
        if not info:
            print(f"AVISO: codigo {code} nao encontrado no indice; pulando.")
            continue
        print(f"Coletando {info['name']} ({info['uf']})...")
        state_id = code[:2]
        pop2022 = pop_all.get(code)
        area = area_all.get(code)
        census = fetch_census_history(code)
        vab = fetch_vab(code)
        historico = fetch_historico(code)
        gdp = gdp_all.get(code)
        material = {
            "code": code,
            "name": info["name"],
            "uf": info["uf"],
            "stateId": state_id,
            "stateName": info["stateName"],
            "meso": info["meso"],
            "pop2022": pop2022,
            "pop2010": census.get("2010"),
            "pop2000": census.get("2000"),
            "areaKm2": area,
            "density": round(pop2022 / area, 1) if pop2022 and area else None,
            "rankPopUf": rank_in_state.get(code),
            "totalMunUf": len(by_state_pop.get(state_id, [])),
            "pibYear": PIB_YEAR,
            "pibTotal": gdp,
            "pibPerCapita": round(gdp / pop2022) if gdp and pop2022 else None,
            "pibPerCapitaMedianoUf": round(median_pc.get(state_id, 0)),
            "vab": vab,
            "idhmUfProxy": idhm_states.get(state_id),
            "historico": historico,
        }
        material["materialHash"] = hashlib.sha256(
            json.dumps(material, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()[:16]
        cities[code] = material
        time.sleep(0.5)
    return cities


def fill_prompt(template, material):
    vab = material.get("vab") or {}
    pct = vab.get("pct") or {}
    historico = material.get("historico") or {}
    idhm = material.get("idhmUfProxy") or {}

    def number(value):
        return f"{value:,.0f}".replace(",", ".") if value is not None else "não disponível"

    replacements = {
        "{{NOME}}": material["name"],
        "{{UF}}": material["uf"],
        "{{MESORREGIAO}}": material.get("meso") or "não disponível",
        "{{DIST_CAPITAL_KM}}": "não disponível",
        "{{VIZINHOS}}": "não disponível",
        "{{POP_2022}}": number(material.get("pop2022")),
        "{{POP_2010}}": number(material.get("pop2010")),
        "{{POP_2000}}": number(material.get("pop2000")),
        "{{AREA_KM2}}": number(material.get("areaKm2")),
        "{{DENSIDADE}}": str(material.get("density") or "não disponível"),
        "{{RANK_POP_UF}}": str(material.get("rankPopUf") or "?"),
        "{{TOTAL_MUN_UF}}": str(material.get("totalMunUf") or "?"),
        "{{PIB_TOTAL}}": number(material.get("pibTotal")) + f" ({material.get('pibYear')})",
        "{{PIB_PC}}": number(material.get("pibPerCapita")),
        "{{PIB_PC_MEDIANO_UF}}": number(material.get("pibPerCapitaMedianoUf")),
        "{{VAB_AGRO_PCT}}": str(pct.get("agro", "não disponível")),
        "{{VAB_IND_PCT}}": str(pct.get("industria", "não disponível")),
        "{{VAB_SERV_PCT}}": str(pct.get("servicos", "não disponível")),
        "{{VAB_ADM_PCT}}": str(pct.get("admPublica", "não disponível")),
        "{{ATIVIDADE_TOP}}": "não disponível",
        "{{ROYALTIES}}": "não disponível",
        "{{SALARIO_MEDIO}}": "não disponível",
        "{{PCT_OCUPADA}}": "não disponível",
        "{{IDHM}}": (f"{idhm.get('idhm')} — ATENÇÃO: IDHM da UF ({material['uf']}), proxy estadual, não municipal"
                     if idhm else "não disponível"),
        "{{IDHM_ANO}}": idhm.get("year", ""),
        "{{ENEM}}": "não disponível",
        "{{TEXTO_HISTORICO_IBGE}}": historico.get("text") or "não disponível",
    }
    filled = template
    for key, value in replacements.items():
        filled = filled.replace(key, value)
    if vab.get("year") and vab["year"] != material.get("pibYear"):
        filled = filled.replace(
            "Composição do valor adicionado (VAB):",
            f"Composição do valor adicionado (VAB, ano {vab['year']} — último publicado no nível municipal):",
        )
    return filled


def extract_prompt_template(repo_root):
    path = os.path.join(repo_root, "prompt-mestre-atlas-cidades.md")
    with open(path, encoding="utf-8") as handle:
        content = handle.read()
    match = re.search(r"## O PROMPT\s+```\n(.*?)```", content, re.DOTALL)
    if not match:
        raise SystemExit("Bloco '## O PROMPT' não encontrado no prompt-mestre.")
    return match.group(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--material", help="caminho do JSON de material-fonte a gravar")
    parser.add_argument("--prompts", help="diretório onde gravar um prompt preenchido por cidade")
    parser.add_argument("--uf", help="sigla da UF (ex.: RR) para coletar TODOS os municípios dessa UF")
    parser.add_argument("--codes", help="lista de códigos IBGE separados por vírgula (sobrepõe TEST_CITIES)")
    args = parser.parse_args()
    if not args.material and not args.prompts:
        parser.error("informe --material e/ou --prompts")

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    codes = None
    if args.uf:
        print(f"Filtrando municipios da UF {args.uf.upper()}...")
        full_index = fetch_city_index()
        codes = sorted(code for code, info in full_index.items() if info["uf"] == args.uf.upper())
        if not codes:
            raise SystemExit(f"Nenhum municipio encontrado para UF '{args.uf}'.")
        print(f"{len(codes)} municipios encontrados em {args.uf.upper()}.")
    elif args.codes:
        codes = [c.strip() for c in args.codes.split(",") if c.strip()]

    cities = build_material(repo_root, codes=codes)
    payload = {
        "generatedAt": time.strftime("%Y-%m-%d"),
        "pibYear": PIB_YEAR,
        "note": "Material-fonte para o prompt-mestre de histórias; VAB usa o último ano publicado no nível municipal.",
        "cities": cities,
    }

    if args.material:
        os.makedirs(os.path.dirname(os.path.abspath(args.material)), exist_ok=True)
        with open(args.material, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        print(f"Material gravado em {args.material} ({len(cities)} cidades)")

    if args.prompts:
        template = extract_prompt_template(repo_root)
        os.makedirs(args.prompts, exist_ok=True)
        for code, material in cities.items():
            out = os.path.join(args.prompts, f"prompt_{code}.txt")
            with open(out, "w", encoding="utf-8") as handle:
                handle.write(fill_prompt(template, material))
        print(f"Prompts gravados em {args.prompts}")


if __name__ == "__main__":
    sys.exit(main())
