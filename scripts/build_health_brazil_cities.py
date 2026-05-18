"""Orchestrator: rebuild data/health_brazil_cities.json with real DATASUS values.

For each municipality, this script merges:
    * CNES LT  (leitos, leitos SUS, UTI)                    -> bedsPer1000 / susBedsPer1000 / icuBedsPer100k
    * CNES PF  (medicos, enfermeiros)                       -> doctorsPer1000 / nursesPer1000
    * SIM + SINASC (mortalidade infantil/materna, 3 anos)   -> infantMortality / maternalMortality
    * PNI legado (cobertura vacinal media, 2019)            -> vaccinationCoverage

Cidades sem dado real continuam com o proxy da UF, exatamente como antes.
Cada linha indica quais campos sao reais via `realFields`, e o campo
`coverage` resume o estado: "municipal" / "uf_proxy" / "partial".

Uso:
    python -m scripts.build_health_brazil_cities                    # padrao
    python -m scripts.build_health_brazil_cities --cnes-month 2024 1 --sim-end 2022 --pni-year 2019
    python -m scripts.build_health_brazil_cities --ufs GO SP        # subset para debug
"""

from __future__ import annotations

import argparse
import json
import sys
from copy import deepcopy
from pathlib import Path

from scripts.datasus import UFS, six_to_seven_map
from scripts.datasus.cnes_leitos import (
    aggregate_leitos_by_municipality,
    compute_rates as compute_leitos_rates,
    fetch_cnes_leitos,
)
from scripts.datasus.cnes_profissionais import (
    aggregate_profissionais_by_municipality,
    compute_rates as compute_prof_rates,
    fetch_cnes_profissionais,
)
from scripts.datasus.pni import (
    aggregate_coverage_by_municipality,
    compute_rates as compute_pni_rates,
    fetch_pni_coverage,
)
from scripts.datasus.population import fetch_population_by_ibge
from scripts.datasus.sim_sinasc import (
    compute_rates as compute_mortality_rates,
    fetch_mortality_3yr_avg,
)

ROOT = Path(__file__).resolve().parents[1]
HEALTH_UF_PATH = ROOT / "data" / "health_brazil.json"
HEALTH_CITIES_PATH = ROOT / "data" / "health_brazil_cities.json"


def load_existing_cities():
    return json.loads(HEALTH_CITIES_PATH.read_text(encoding="utf-8"))


def save_cities(payload):
    HEALTH_CITIES_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def merge_into_city_row(row: dict, leitos: dict | None, prof: dict | None,
                       mort: dict | None, vacc: dict | None,
                       cnes_competence: str, sim_window: str) -> dict:
    """Return an updated copy of `row` with whatever real fields we have."""
    updated = deepcopy(row)
    real_fields = []
    sources = set()

    if leitos:
        updated["bedsPer1000"] = leitos["bedsPer1000"]
        updated["susBedsPer1000"] = leitos["susBedsPer1000"]
        updated["icuBedsPer100k"] = leitos["icuBedsPer100k"]
        real_fields += ["bedsPer1000", "susBedsPer1000", "icuBedsPer100k"]
        sources.add(f"CNES/LT {cnes_competence}")

    if prof:
        updated["doctorsPer1000"] = prof["doctorsPer1000"]
        updated["nursesPer1000"] = prof["nursesPer1000"]
        real_fields += ["doctorsPer1000", "nursesPer1000"]
        sources.add(f"CNES/PF {cnes_competence}")

    if mort:
        updated["infantMortality"] = mort["infantMortality"]
        updated["maternalMortality"] = mort["maternalMortality"]
        real_fields += ["infantMortality", "maternalMortality"]
        sources.add(f"SIM+SINASC media {sim_window}")

    if vacc:
        updated["vaccinationCoverage"] = vacc["vaccinationCoverage"]
        real_fields.append("vaccinationCoverage")
        sources.add(f"PNI legado {vacc['pniYear']}")

    all_fields = {
        "bedsPer1000", "susBedsPer1000", "icuBedsPer100k",
        "doctorsPer1000", "nursesPer1000",
        "infantMortality", "maternalMortality",
        "vaccinationCoverage",
    }
    has_any_real = bool(real_fields)
    updated["proxy"] = not has_any_real
    updated["realFields"] = real_fields
    if has_any_real:
        updated["coverage"] = "municipal" if all_fields.issubset(real_fields) else "partial"
        updated["source"] = " + ".join(sorted(sources))
    else:
        updated["coverage"] = "uf_proxy"
    return updated


def update_metadata(payload: dict, totals: dict, cnes_competence: str,
                    sim_window: str, pni_year: int) -> None:
    real_count = totals["real"]
    partial_count = totals["partial"]
    proxy_count = totals["proxy"]

    meta = payload.setdefault("metadata", {})
    meta["title"] = "Indicadores municipais de saude e capacidade hospitalar"
    meta["source"] = "CNES/SIM/SINASC/PNI + IBGE Sidra"
    meta["sourceUrl"] = "https://datasus.saude.gov.br/informacoes-de-saude-tabnet/"
    meta["provenance"] = "misto"
    meta["freshness"] = (
        f"CNES {cnes_competence}; mortalidade media movel {sim_window}; "
        f"PNI legado {pni_year}"
    )
    meta["quality"] = "Cobertura completa com sinalizacao de proxy"
    meta["municipalityCount"] = real_count + partial_count + proxy_count
    meta["realMunicipalityCount"] = real_count
    meta["partialMunicipalityCount"] = partial_count
    meta["proxyMunicipalityCount"] = proxy_count
    meta["methodology"] = (
        "Cidades com dados em todos os 5 grupos (leitos, profissionais, "
        "mortalidade, vacinacao) sao marcadas como coverage=municipal. "
        "Cidades com apenas parte dos grupos sao coverage=partial e mantem "
        "proxy UF nos campos restantes. Cidades sem nenhum grupo continuam "
        "coverage=uf_proxy."
    )
    meta["limitations"] = [
        "PNI legado vai ate 2019; SI-PNI nominal (2020+) ainda nao integrado.",
        "Mortalidade municipal usa media movel de 3 anos e exclui cidades com <30 nascidos vivos no periodo.",
        "Leitos UTI = TP_LEITO complementar (inclui UTI Adulto/Infantil/Neonatal e UCIs).",
        "Profissionais usam CNS_PROF para deduplicacao; um profissional com vinculo em multiplas cidades e contado em cada uma.",
    ]
    meta["updatePolicy"] = (
        "Reexecutar scripts/build_health_brazil_cities.py periodicamente. "
        "Pysus invalida o cache local quando o catalogo do DATASUS atualiza."
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cnes-year", type=int, default=2024)
    parser.add_argument("--cnes-month", type=int, default=1)
    parser.add_argument("--sim-end", type=int, default=2022,
                        help="Ultimo ano da janela movel SIM/SINASC (inclui -1 e -2)")
    parser.add_argument("--pni-year", type=int, default=2019)
    parser.add_argument("--ufs", nargs="*", default=None,
                        help="Subset de UFs para teste rapido")
    args = parser.parse_args()

    target_ufs = args.ufs or UFS
    cnes_competence = f"{args.cnes_year}-{args.cnes_month:02d}"
    sim_window = f"{args.sim_end - 2}-{args.sim_end}"

    print(f"[1/5] Buscando populacao IBGE Sidra (Censo 2022)...", flush=True)
    population = fetch_population_by_ibge()
    six_seven = six_to_seven_map(population.keys())
    print(f"      municipios com populacao: {len(population):,}")

    print(f"[2/5] CNES LT {cnes_competence} para {len(target_ufs)} UFs...", flush=True)
    df = fetch_cnes_leitos(args.cnes_year, args.cnes_month, target_ufs)
    leitos_rates = compute_leitos_rates(
        aggregate_leitos_by_municipality(df), six_seven, population,
    )
    print(f"      municipios com leitos: {len(leitos_rates):,}")

    print(f"[3/5] CNES PF {cnes_competence}...", flush=True)
    df = fetch_cnes_profissionais(args.cnes_year, args.cnes_month, target_ufs)
    prof_rates = compute_prof_rates(
        aggregate_profissionais_by_municipality(df), six_seven, population,
    )
    print(f"      municipios com profissionais: {len(prof_rates):,}")

    print(f"[4/5] SIM + SINASC janela {sim_window}...", flush=True)
    agg = fetch_mortality_3yr_avg(args.sim_end, target_ufs)
    mortality_rates = compute_mortality_rates(agg, six_seven)
    print(f"      municipios com mortalidade publicavel: {len(mortality_rates):,}")

    print(f"[5/5] PNI legado {args.pni_year}...", flush=True)
    df = fetch_pni_coverage(args.pni_year, target_ufs)
    vaccination_rates = compute_pni_rates(
        aggregate_coverage_by_municipality(df), six_seven,
    )
    print(f"      municipios com cobertura PNI: {len(vaccination_rates):,}")

    print("Mesclando em health_brazil_cities.json...", flush=True)
    payload = load_existing_cities()
    cities = payload.setdefault("cities", {})

    totals = {"real": 0, "partial": 0, "proxy": 0, "touched": 0}
    for code7, row in cities.items():
        in_scope = (not args.ufs) or row.get("uf") in args.ufs
        if in_scope:
            row = merge_into_city_row(
                row,
                leitos_rates.get(code7),
                prof_rates.get(code7),
                mortality_rates.get(code7),
                vaccination_rates.get(code7),
                cnes_competence,
                sim_window,
            )
            cities[code7] = row
            totals["touched"] += 1
        coverage = row.get("coverage")
        if coverage == "municipal" or coverage == "municipal_initial":
            totals["real"] += 1
        elif coverage == "partial":
            totals["partial"] += 1
        else:
            totals["proxy"] += 1

    update_metadata(payload, totals, cnes_competence, sim_window, args.pni_year)
    save_cities(payload)

    print()
    print(f"OK: {totals['touched']:,} cidades processadas")
    print(f"  municipal (todos 5 grupos):  {totals['real']:,}")
    print(f"  partial   (alguns grupos):   {totals['partial']:,}")
    print(f"  uf_proxy  (nenhum grupo):    {totals['proxy']:,}")


if __name__ == "__main__":
    sys.exit(main())
