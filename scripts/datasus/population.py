"""Population per IBGE municipality, fetched from IBGE Sidra.

Uses the same source as the front-end (app.js URLS.cityPopulation):
table 4714 (Census 2022), variable 93 (Population), n6 = municipalities.
"""

import gzip
import json
import urllib.request


SIDRA_URL = "https://apisidra.ibge.gov.br/values/t/4714/n6/all/v/93/p/2022"


def _fetch_json(url):
    raw = urllib.request.urlopen(url, timeout=120).read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def fetch_population_by_ibge():
    """Return {ibgeCode7: population_int} from IBGE Sidra Census 2022.

    The Sidra response has a header row followed by data rows. Each row is a
    dict with codes including 'D1C' (municipality 7-digit) and value 'V'.
    """
    rows = _fetch_json(SIDRA_URL)
    if not rows or len(rows) < 2:
        raise RuntimeError("Sidra returned empty payload")

    out = {}
    for row in rows[1:]:
        code = str(row.get("D1C", "")).strip()
        if not code or not code.isdigit() or len(code) != 7:
            continue
        try:
            pop = int(float(row["V"]))
        except (KeyError, TypeError, ValueError):
            continue
        if pop > 0:
            out[code] = pop
    return out


if __name__ == "__main__":
    pop = fetch_population_by_ibge()
    print(f"Municipalities: {len(pop)}")
    sample = list(pop.items())[:3]
    for code, value in sample:
        print(f"  {code}: {value:,}")
