import gzip
import json
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HEALTH_UF_PATH = ROOT / "data" / "health_brazil.json"
HEALTH_CITIES_PATH = ROOT / "data" / "health_brazil_cities.json"
IBGE_MUNICIPIOS_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome"


def fetch_json(url):
    raw = urllib.request.urlopen(url, timeout=60).read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def city_uf(city):
    if city.get("microrregiao"):
        return city["microrregiao"]["mesorregiao"]["UF"]["sigla"]
    return city["regiao-imediata"]["regiao-intermediaria"]["UF"]["sigla"]


def normalize_city_name(name):
    return (
        name.replace("ã", "a")
        .replace("á", "a")
        .replace("à", "a")
        .replace("â", "a")
        .replace("é", "e")
        .replace("ê", "e")
        .replace("í", "i")
        .replace("ó", "o")
        .replace("ô", "o")
        .replace("õ", "o")
        .replace("ú", "u")
        .replace("ç", "c")
        .replace("Á", "A")
        .replace("É", "E")
        .replace("Í", "I")
        .replace("Ó", "O")
        .replace("Ú", "U")
        .replace("Ç", "C")
    )


def main():
    health_uf = json.loads(HEALTH_UF_PATH.read_text(encoding="utf-8"))
    previous = json.loads(HEALTH_CITIES_PATH.read_text(encoding="utf-8"))
    previous_cities = previous.get("cities", {})
    municipalities = fetch_json(IBGE_MUNICIPIOS_URL)

    cities = {}
    for city in municipalities:
        code = str(city["id"])
        uf = city_uf(city)
        state_row = health_uf["states"].get(uf, {})
        if code in previous_cities and not previous_cities[code].get("proxy"):
            row = dict(previous_cities[code])
            row["proxy"] = False
            row["coverage"] = "municipal_initial"
        else:
            row = {
                "ibgeCode": code,
                "name": normalize_city_name(city["nome"]),
                "uf": uf,
                "bedsPer1000": state_row.get("bedsPer1000", 0),
                "susBedsPer1000": state_row.get("susBedsPer1000", 0),
                "icuBedsPer100k": state_row.get("icuBedsPer100k", 0),
                "doctorsPer1000": state_row.get("doctorsPer1000", 0),
                "nursesPer1000": state_row.get("nursesPer1000", 0),
                "infantMortality": state_row.get("infantMortality", 0),
                "maternalMortality": state_row.get("maternalMortality", 0),
                "vaccinationCoverage": state_row.get("vaccinationCoverage", 0),
                "privateCoverage": state_row.get("privateCoverage", 0),
                "year": state_row.get("year", 2023),
                "source": "Proxy UF from data/health_brazil.json",
                "proxy": True,
                "coverage": "uf_proxy"
            }
        cities[code] = row

    output = {
        "metadata": {
            "title": "Indicadores municipais de saude e capacidade hospitalar",
            "source": "CNES/SIM/SINASC/SI-PNI/IBGE + proxy UF",
            "sourceUrl": "https://datasus.saude.gov.br/informacoes-de-saude-tabnet/",
            "provenance": "misto",
            "freshness": "Base municipal inicial 2022-2024; cobertura territorial completa por proxy UF",
            "quality": "Cobertura completa com sinalizacao de proxy",
            "municipalityCount": len(cities),
            "realMunicipalityCount": sum(1 for row in cities.values() if not row.get("proxy")),
            "proxyMunicipalityCount": sum(1 for row in cities.values() if row.get("proxy")),
            "methodology": "O arquivo cobre todos os municipios retornados pela API de Localidades do IBGE. Cidades com linha municipal inicial preservada usam proxy=false. As demais recebem indicadores da UF e proxy=true, ate a extracao completa de CNES/SIM/SINASC/SI-PNI por codigo IBGE.",
            "limitations": [
                "A maior parte da cobertura municipal ainda e proxy da UF.",
                "Proxy UF nao deve ser usado como ranking municipal real.",
                "Cidades polo hospitalar atendem populacao regional; indicadores de capacidade por residente exigem leitura cuidadosa.",
                "Mortalidade municipal deve usar media movel de 3 anos quando a extracao oficial completa for implementada."
            ],
            "updatePolicy": "Substituir linhas proxy=true por dados reais extraidos de CNES, SIM, SINASC, SI-PNI e IBGE por codigo IBGE de 7 digitos."
        },
        "cities": cities
    }
    HEALTH_CITIES_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(cities)} cities: {output['metadata']['realMunicipalityCount']} municipal, {output['metadata']['proxyMunicipalityCount']} proxy")


if __name__ == "__main__":
    main()
