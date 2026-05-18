import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "security_brazil_cities_atlas2024.csv"
OUTPUT_PATH = ROOT / "data" / "security_brazil_cities.json"


def parse_int(value):
    return int(str(value).replace(".", "").strip())


def parse_rate(value):
    return float(str(value).replace(",", ".").strip())


def build():
    cities = {}
    with CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            code = str(row["ibgeCode"]).strip()
            cities[code] = {
                "ibgeCode": code,
                "name": row["name"],
                "uf": row["uf"],
                "region": row["region"],
                "rank": parse_int(row["rank"]),
                "population2022": parse_int(row["population2022"]),
                "registeredHomicides": parse_int(row["registeredHomicides"]),
                "hiddenHomicides": parse_int(row["hiddenHomicides"]),
                "estimatedHomicides": parse_int(row["estimatedHomicides"]),
                "homicideRate": parse_rate(row["homicideRate"]),
                "year": parse_int(row["year"]),
            }

    return {
        "metadata": {
            "title": "Homicidios estimados por municipio com mais de 100 mil habitantes",
            "source": "IPEA Atlas da Violencia 2024 - Retrato dos Municipios Brasileiros / FBSP / SIM-MS / IBGE Censo 2022",
            "sourceUrl": "https://repositorio.ipea.gov.br/bitstream/11058/14031/5/AtlasViolencia2024_Retrato_dos_municipios_brasileros.pdf",
            "provenance": "official_extracted_pdf",
            "freshness": "Atlas da Violencia 2024, ano-base 2022",
            "quality": "Oficial, extraido da Tabela 2 do PDF",
            "municipalityCount": len(cities),
            "coveredPopulationCriterion": "Municipios brasileiros com mais de 100 mil habitantes segundo o Censo 2022",
            "year": 2022,
            "methodology": "Taxa de homicidios estimados por 100 mil habitantes. O numero de homicidios estimados no municipio de residencia soma homicidios registrados (CID-10 X85-Y09 e Y35-Y36) e homicidios ocultos estimados por Cerqueira e Lins (2024), conforme nota metodologica do Atlas.",
            "limitations": [
                "Cobertura restrita aos 319 municipios com mais de 100 mil habitantes em 2022.",
                "Municipios fora da Tabela 2 usam proxy pela UF no app.",
                "Indicador municipal cobre homicidios estimados; outros indicadores de seguranca na aba continuam estaduais.",
                "Taxas de municipios pequenos nao foram incorporadas porque o proprio Atlas recomenda cautela para esse porte populacional.",
            ],
            "updatePolicy": "Atualizar data/security_brazil_cities_atlas2024.csv a partir da Tabela 2 da publicacao municipal mais recente do Atlas da Violencia e regenerar data/security_brazil_cities.json.",
        },
        "cities": cities,
        "coverageNote": "Cobertura oficial da Tabela 2: 319 municipios com mais de 100 mil habitantes. Demais municipios usam proxy UF.",
    }


def main():
    output = build()
    OUTPUT_PATH.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(output['cities'])} cities to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
