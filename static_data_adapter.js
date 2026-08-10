(function (global) {
  "use strict";

  const DATA_ROOT = "./data/parquet/site";
  const ATLAS_ROOT = `${DATA_ROOT}/atlas`;

  const URLS = Object.freeze({
    master: `${ATLAS_ROOT}/city_indicators_master.parquet`,
    hdiGlobal: `${ATLAS_ROOT}/hdi_global.parquet`,
    hdiOwid: `${ATLAS_ROOT}/hdi_owid.parquet`,
    idhmBrazil: `${ATLAS_ROOT}/idhm_brazil.parquet`,
    securityGlobal: `${ATLAS_ROOT}/security_global.parquet`,
    securityBrazil: `${ATLAS_ROOT}/security_brazil.parquet`,
    securityBrazilCities: `${ATLAS_ROOT}/security_brazil_cities.parquet`,
    healthGlobal: `${ATLAS_ROOT}/health_global.parquet`,
    healthBrazil: `${ATLAS_ROOT}/health_brazil.parquet`,
    healthBrazilCities: `${ATLAS_ROOT}/health_brazil_cities.parquet`,
    storiesBrazilCities: `${ATLAS_ROOT}/stories_brazil_cities.parquet`,
    ipsBrazil: `${ATLAS_ROOT}/ips_brazil.parquet`,
    ipsBrazilCities: (year) => `${ATLAS_ROOT}/ips_brazil_cities_${year}.parquet`,
    sectorCatalog: `${ATLAS_ROOT}/sector_catalog.parquet`,
    world: `${ATLAS_ROOT}/world_data.parquet`,
    states: `${DATA_ROOT}/states.parquet`,
    municipalities: (uf) => `${DATA_ROOT}/municipalities/${String(uf).toUpperCase()}.parquet`,
    sectors: (uf, cityId) => `${DATA_ROOT}/sectors/${String(uf).toUpperCase()}/${cityId}.parquet`
  });
  let sectorCatalogPromise = null;

  function readRows(url, options) {
    return global.AtlasParquet.readRows(url, options);
  }

  function isValue(value) {
    return value !== null && value !== undefined && !(typeof value === "number" && Number.isNaN(value));
  }

  function latestValues(rows, fields) {
    const result = {};
    fields.forEach((field) => {
      const candidates = rows.filter((row) => isValue(row[field]));
      if (candidates.length) {
        result[field] = candidates.reduce((latest, row) =>
          Number(row.year || 0) > Number(latest.year || 0) ? row : latest
        )[field];
      }
    });
    const years = rows.map((row) => Number(row.year)).filter(Number.isFinite);
    if (years.length) result.year = Math.max(...years);
    return result;
  }

  function hdiPayload(rows, owid) {
    const countries = {};
    const years = new Set();
    rows.forEach((row) => {
      if (!isValue(row.hdi) || !/^[A-Z]{3}$/.test(String(row.iso3 || ""))) return;
      const year = Number(row.year);
      const iso3 = String(row.iso3);
      years.add(year);
      const country = countries[iso3] ||= {
        iso3,
        country: row.country || iso3,
        region: row.region,
        category: row.hdicode,
        history: {}
      };
      country.history[String(year)] = Number(row.hdi);
      if (!owid && isValue(row.hdi_rank)) country.rank2023 = Number(row.hdi_rank);
    });
    const orderedYears = [...years].sort((a, b) => a - b);
    return {
      source: { label: owid ? "Our World in Data / UNDP" : "UNDP Human Development Report", format: "Parquet offline" },
      latestYear: orderedYears.at(-1) || null,
      years: orderedYears.map(String),
      countries
    };
  }

  function idhmPayload(rows) {
    const fields = {
      idhm: "idhm", idhm_l: "longevity", idhm_e: "education", idhm_r: "income",
      idhmad: "adjusted", espvida: "lifeExpectancy", rdpc: "incomePerCapita", gini: "gini"
    };
    const brazil = { history: {} };
    const states = {};
    const years = new Set();
    rows.filter((row) => !row.sheet || row.sheet === "Base de Dados").forEach((row) => {
      if (!isValue(row.ano) || !isValue(row.idhm)) return;
      const year = Number(row.ano);
      const history = {};
      Object.entries(fields).forEach(([source, target]) => {
        if (isValue(row[source])) history[target] = Number(row[source]);
      });
      years.add(year);
      if (String(row.agregacao || "").toUpperCase() === "BRASIL") {
        brazil.history[String(year)] = history;
      } else if (String(row.agregacao || "").toUpperCase() === "UF" && isValue(row.codigo)) {
        const id = String(Number(row.codigo)).padStart(2, "0");
        const state = states[id] ||= { id, name: row.nome || id, history: {} };
        state.history[String(year)] = history;
      }
    });
    const orderedYears = [...years].sort((a, b) => a - b);
    return { latestYear: orderedYears.at(-1) || null, years: orderedYears.map(String), brazil, states };
  }

  function territorialPayload(rows, fields, options = {}) {
    const groups = {};
    const idColumn = options.global ? "iso3" : "territory_id";
    rows.forEach((row) => (groups[String(row[idColumn])] ||= []).push(row));
    if (options.global) {
      const countries = {};
      Object.entries(groups).forEach(([iso3, entries]) => {
        countries[iso3] = { iso3, ...latestValues(entries, fields), source: options.source || "ETL oficial" };
      });
      return { metadata: { format: "Parquet offline" }, countries };
    }
    let brazil = {};
    const states = {};
    Object.entries(groups).forEach(([id, entries]) => {
      const latest = { ...latestValues(entries, fields), source: options.source || "ETL oficial" };
      if (id === "BRA") brazil = latest;
      else states[id] = { ...latest, uf: id };
    });
    return { metadata: { format: "Parquet offline" }, brazil, states };
  }

  function cityPayload(rows) {
    const cities = {};
    rows.forEach((row) => {
      const payload = row.data_json ? JSON.parse(row.data_json) : { ...row };
      delete payload.data_json;
      cities[String(row.ibge_code)] = { ...payload, ibgeCode: String(row.ibge_code) };
    });
    return { cities };
  }

  function masterCompatibility(rows, stateCatalog) {
    const byState = Object.fromEntries(stateCatalog.map((state) => [String(state.id), state]));
    const statePopulation = {};
    const stateGdp = {};
    const brazilGdp = {};
    const cities = [];
    const cityPopulation = [];
    const cityGdp = [];

    rows.forEach((row) => {
      const id = String(row.ibge_code);
      const stateId = String(row.state_id).padStart(2, "0");
      const state = byState[stateId] || { id: stateId, sigla: row.uf, nome: row.uf };
      const payload = row.data_json ? JSON.parse(row.data_json) : row;
      const population = Number(row.pop || payload.pop || 0);
      statePopulation[stateId] = (statePopulation[stateId] || 0) + population;
      cities.push({
        id,
        nome: row.nome,
        microrregiao: { mesorregiao: { UF: { id: stateId, sigla: state.sigla, nome: state.nome } } }
      });
      cityPopulation.push({ D1C: id, V: String(population) });
      Object.entries(payload.gdpHistory || {}).forEach(([year, value]) => {
        const numeric = Number(value || 0);
        cityGdp.push({ D1C: id, D2C: "37", D3C: year, D3N: year, V: String(numeric / 1000) });
        (stateGdp[stateId] ||= {})[year] = ((stateGdp[stateId] || {})[year] || 0) + numeric;
        brazilGdp[year] = (brazilGdp[year] || 0) + numeric;
      });
    });

    return {
      states: stateCatalog.map((state) => ({ id: state.id, sigla: state.sigla, nome: state.nome, regiao: { nome: state.regiao } })),
      cities,
      statePopulation: Object.entries(statePopulation).map(([id, value]) => ({ D1C: id, V: String(value) })),
      cityPopulation,
      gdpBrazil: Object.entries(brazilGdp).map(([year, value]) => ({ D1C: "1", D2C: "37", D3C: year, D3N: year, V: String(value / 1000) })),
      gdpStates: Object.entries(stateGdp).flatMap(([id, history]) =>
        Object.entries(history).map(([year, value]) => ({ D1C: id, D2C: "37", D3C: year, D3N: year, V: String(value / 1000) }))
      ),
      gdpCities: cityGdp,
      master: cityPayload(rows)
    };
  }

  function jsonParquetPayload(rows, collectionKey) {
    if (!rows.length) return null;
    if (rows.length === 1 && rows[0].payload_json) return JSON.parse(rows[0].payload_json);
    const metadata = rows[0].metadata_json ? JSON.parse(rows[0].metadata_json) : {};
    const collection = {};
    rows.forEach((row) => {
      const id = String(row.ibge_code || row.id);
      collection[id] = row.payload_json ? JSON.parse(row.payload_json) : row;
    });
    return { ...metadata, [collectionKey]: collection };
  }

  async function loadInitial(stateCatalog, ipsYear) {
    const [masterRows, hdiRows, owidRows, idhmRows, securityGlobalRows, securityBrazilRows,
      securityCityRows, healthGlobalRows, healthBrazilRows, healthCityRows, storiesRows,
      ipsBrazilRows, ipsCityRows, statesRows, worldRows] = await Promise.all([
      readRows(URLS.master), readRows(URLS.hdiGlobal), readRows(URLS.hdiOwid), readRows(URLS.idhmBrazil),
      readRows(URLS.securityGlobal), readRows(URLS.securityBrazil), readRows(URLS.securityBrazilCities),
      readRows(URLS.healthGlobal), readRows(URLS.healthBrazil), readRows(URLS.healthBrazilCities),
      readRows(URLS.storiesBrazilCities), readRows(URLS.ipsBrazil), readRows(URLS.ipsBrazilCities(ipsYear)),
      readRows(URLS.states), readRows(URLS.world)
    ]);
    const master = masterCompatibility(masterRows, stateCatalog);
    const statesMesh = global.AtlasParquet.rowsToFeatureCollection(statesRows, { idColumn: "uf" });
    statesMesh.features.forEach((feature) => {
      const state = stateCatalog.find((item) => item.sigla === feature.properties.uf);
      if (state) feature.properties.id = state.id;
    });
    const world = worldFeatureCollection(worldRows);
    const brazilMesh = {
      type: "FeatureCollection",
      features: world.features.filter((feature) => {
        const p = feature.properties || {};
        return [p.ISO_A3, p.ADM0_A3, p.iso3].includes("BRA");
      })
    };
    return {
      ...master,
      hdiGlobal: hdiPayload(hdiRows, false),
      hdiOwid: hdiPayload(owidRows, true),
      idhmBrazil: idhmPayload(idhmRows),
      securityGlobal: territorialPayload(securityGlobalRows, ["homicideRate"], { global: true, source: "UNODC" }),
      securityBrazil: territorialPayload(securityBrazilRows, ["mviRate", "vehicleTheftRate", "femicideRate", "domesticViolenceRate", "mvi"], { source: "FBSP" }),
      securityBrazilCities: cityPayload(securityCityRows),
      healthGlobal: territorialPayload(healthGlobalRows, ["lifeExpectancy", "healthyLifeExpectancy", "uhcIndex", "hospitalBedsPer10000", "physiciansPer10000", "nursesMidwivesPer10000", "healthExpPctGdp", "outOfPocketPct"], { global: true, source: "WHO/Banco Mundial" }),
      healthBrazil: territorialPayload(healthBrazilRows, ["bedsPer1000", "susBedsPer1000", "icuBedsPer100k", "doctorsPer1000", "nursesPer1000", "infantMortality", "maternalMortality", "vaccinationCoverage", "privateCoverage"], { source: "DATASUS/IBGE" }),
      healthBrazilCities: cityPayload(healthCityRows),
      storiesBrazilCities: jsonParquetPayload(storiesRows, "cities"),
      ipsBrazil: jsonParquetPayload(ipsBrazilRows, "states"),
      ipsBrazilCities: jsonParquetPayload(ipsCityRows, "cities"),
      brazilMesh,
      statesMesh,
      world
    };
  }

  function worldFeatureCollection(rows) {
    if (rows.some((row) => row.geometry)) {
      return global.AtlasParquet.rowsToFeatureCollection(rows, { idColumn: "feature_id" });
    }
    return {
      type: "FeatureCollection",
      features: rows.map((row) => ({
        type: row.type || "Feature",
        id: row.feature_id,
        properties: row.properties_json ? JSON.parse(row.properties_json) : {},
        geometry: row.geometry_json ? JSON.parse(row.geometry_json) : null
      })).filter((feature) => feature.geometry)
    };
  }

  async function loadMunicipalities(uf) {
    const rows = await readRows(URLS.municipalities(uf));
    const collection = global.AtlasParquet.rowsToFeatureCollection(rows, { idColumn: "ibge_code" });
    collection.features.forEach((feature) => {
      feature.properties.id = String(feature.properties.ibge_code);
    });
    return collection;
  }

  async function loadSectors(uf, cityId) {
    sectorCatalogPromise ||= readRows(URLS.sectorCatalog).then((rows) => jsonParquetPayload(rows, "indicators"));
    const [collection, catalog] = await Promise.all([
      global.AtlasParquet.readFeatureCollection(URLS.sectors(uf, cityId), { idColumn: "sector_id" }),
      sectorCatalogPromise
    ]);
    collection.features.forEach((feature) => {
      const p = feature.properties;
      p.id = String(p.sector_id);
      p.CD_SETOR = p.id;
      p.name = `Setor ${p.id}`;
      p.bairroNome = p.bairro;
      p.NM_BAIRRO = p.bairro;
      p.NM_DISTRI = p.distrito;
      p.municipio_id = String(p.ibge_code || cityId);
    });
    collection.indicators = (catalog && catalog.indicators) || [];
    collection.metadata = {
      source: "IBGE Censo Demográfico 2022",
      catalogVersion: catalog && catalog.schemaVersion,
      censusYear: catalog && catalog.censusYear,
      geographicLevel: catalog && catalog.geographicLevel
    };
    return collection;
  }

  async function loadIpsYear(year) {
    return jsonParquetPayload(await readRows(URLS.ipsBrazilCities(year)), "cities");
  }

  global.AtlasStaticData = Object.freeze({ DATA_ROOT, URLS, loadInitial, loadIpsYear, loadMunicipalities, loadSectors });
})(window);
