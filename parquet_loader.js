(function (global) {
  "use strict";

  const MODULES = Object.freeze({
    parquet: "./vendor/hyparquet/hyparquet.js",
    compressors: "./vendor/hyparquet/zstd-compressor.js"
  });
  const CACHE_NAME = "atlas-brasil-parquet-v1";
  let librariesPromise = null;

  function libraries() {
    if (!librariesPromise) {
      librariesPromise = Promise.all([
        import(MODULES.parquet),
        import(MODULES.compressors)
      ]).then(([parquet, compression]) => ({
        parquetReadObjects: parquet.parquetReadObjects,
        parquetMetadataAsync: parquet.parquetMetadataAsync,
        compressors: compression.compressors
      }));
    }
    return librariesPromise;
  }

  async function fetchBuffer(url) {
    const request = new Request(url, { cache: "no-cache" });
    if (global.caches) {
      const cache = await global.caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached.arrayBuffer();

      const response = await fetch(request);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      await cache.put(request, response.clone());
      return response.arrayBuffer();
    }

    const response = await fetch(request);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
    return response.arrayBuffer();
  }

  function normalizeScalar(value) {
    if (typeof value === "bigint") {
      const numeric = Number(value);
      return Number.isSafeInteger(numeric) ? numeric : value.toString();
    }
    if (value && typeof value === "object" && value.type && Array.isArray(value.coordinates)) {
      return value;
    }
    if (Array.isArray(value)) return value.map(normalizeScalar);
    if (value && typeof value === "object" && !ArrayBuffer.isView(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, normalizeScalar(nested)])
      );
    }
    return value;
  }

  async function readRows(url, options = {}) {
    const [{ parquetReadObjects, compressors }, buffer] = await Promise.all([
      libraries(),
      fetchBuffer(url)
    ]);
    const readOptions = { file: buffer, compressors };
    if (Array.isArray(options.columns)) readOptions.columns = options.columns;
    if (Number.isInteger(options.rowStart)) readOptions.rowStart = options.rowStart;
    if (Number.isInteger(options.rowEnd)) readOptions.rowEnd = options.rowEnd;
    const rows = await parquetReadObjects(readOptions);
    return rows.map(normalizeScalar);
  }

  async function readMetadata(url) {
    const [{ parquetMetadataAsync }, buffer] = await Promise.all([
      libraries(),
      fetchBuffer(url)
    ]);
    return parquetMetadataAsync(buffer);
  }

  function extendBounds(bounds, coordinates) {
    if (!Array.isArray(coordinates)) return;
    if (
      coordinates.length >= 2 &&
      typeof coordinates[0] === "number" &&
      typeof coordinates[1] === "number"
    ) {
      const [x, y] = coordinates;
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
      return;
    }
    coordinates.forEach((part) => extendBounds(bounds, part));
  }

  function rowsToFeatureCollection(rows, options = {}) {
    const geometryColumn = options.geometryColumn || "geometry";
    const idColumn = options.idColumn || "sector_id";
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const features = rows
      .filter((row) => row && row[geometryColumn])
      .map((row) => {
        const geometry = row[geometryColumn];
        extendBounds(bounds, geometry.coordinates);
        const properties = { ...row };
        delete properties[geometryColumn];
        const id = properties[idColumn] == null ? undefined : String(properties[idColumn]);
        return { type: "Feature", id, properties, geometry };
      });
    const validBounds = bounds.every(Number.isFinite) ? bounds : undefined;
    return {
      type: "FeatureCollection",
      ...(validBounds ? { bbox: validBounds } : {}),
      features
    };
  }

  async function readFeatureCollection(url, options = {}) {
    return rowsToFeatureCollection(await readRows(url, options), options);
  }

  function indexRows(rows, key) {
    return Object.fromEntries(
      rows
        .filter((row) => row && row[key] != null)
        .map((row) => [String(row[key]), row])
    );
  }

  global.AtlasParquet = Object.freeze({
    CACHE_NAME,
    fetchBuffer,
    indexRows,
    readFeatureCollection,
    readMetadata,
    readRows,
    rowsToFeatureCollection
  });
})(window);
