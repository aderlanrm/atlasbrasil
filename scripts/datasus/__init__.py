"""DATASUS extractors for municipal health indicators.

Each module returns a dict keyed by 7-digit IBGE municipality code.
The orchestrator (build_health_brazil_cities.py) merges them directly into
data/parquet/health_brazil_cities.parquet. Missing fields remain null and their
coverage is explicit; state values are not copied into municipal observations.
"""

UFS = [
    "AC", "AL", "AP", "AM", "BA", "CE", "ES", "GO", "MA", "MT",
    "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS",
    "RO", "RR", "SC", "SP", "SE", "TO", "DF",
]


def six_to_seven_map(seven_digit_codes):
    """Build a {6-digit: 7-digit} mapping so we can join CNES (6-digit
    CODUFMUN) against the dataset's 7-digit IBGE keys."""
    return {code[:6]: code for code in seven_digit_codes}
