import urllib.request
import json
import os

print("Downloading GeoJSON...")
geo_url = "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson"
req = urllib.request.urlopen(geo_url)
geo_data = json.loads(req.read())

print("Downloading RestCountries data...")
rc_url = "https://restcountries.com/v3.1/all?fields=name,population,area,cca3,region,translations"
req = urllib.request.Request(rc_url, headers={'User-Agent': 'Mozilla/5.0'})
rc_data = json.loads(urllib.request.urlopen(req).read())

rc_map = {}
for country in rc_data:
    iso3 = country.get("cca3")
    if iso3:
        pop = country.get("population", 0)
        area = country.get("area", 0)
        name_pt = country.get("translations", {}).get("por", {}).get("common", country.get("name", {}).get("common", ""))
        region = country.get("region", "")
        rc_map[iso3] = {
            "pop": pop,
            "area": area,
            "name_pt": name_pt,
            "region": region
        }

print("Downloading World Bank GDP data (2024)...")
wb_url = "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?format=json&per_page=300&date=2024"
req = urllib.request.urlopen(wb_url)
wb_data = json.loads(req.read())

wb_map = {}
if len(wb_data) > 1:
    for item in wb_data[1]:
        iso3 = item.get("countryiso3code")
        val = item.get("value")
        if iso3 and val is not None:
            wb_map[iso3] = val

print("Merging data...")
for feature in geo_data["features"]:
    props = feature["properties"]
    iso3 = props.get("ISO_A3") or props.get("ISO3166-1-Alpha-3") or props.get("id")
    
    # Fix for countries with -99 ISO code in some GeoJSON sources
    name_admin = (props.get("ADMIN") or props.get("name") or "").lower()
    if iso3 == "-99":
        if "france" in name_admin: iso3 = "FRA"
        elif "norway" in name_admin: iso3 = "NOR"
        elif "somaliland" in name_admin: iso3 = "SOM"
        elif "kosovo" in name_admin: iso3 = "UNK"
    
    props["ISO_A3"] = iso3
    
    # Defaults
    props["pop"] = 0
    props["areaKm2"] = 0
    props["gdp"] = 0
    props["name_pt"] = props.get("ADMIN", "")
    props["region"] = ""

    if iso3 in rc_map:
        props["pop"] = rc_map[iso3]["pop"]
        props["areaKm2"] = rc_map[iso3]["area"]
        props["name_pt"] = rc_map[iso3]["name_pt"]
        props["region"] = rc_map[iso3]["region"]
        
    if iso3 in wb_map:
        props["gdp"] = wb_map[iso3]

# Create output directory
os.makedirs("data", exist_ok=True)
with open("data/world_data.geojson", "w", encoding="utf-8") as f:
    json.dump(geo_data, f, ensure_ascii=False)

print("Saved data/world_data.geojson")
