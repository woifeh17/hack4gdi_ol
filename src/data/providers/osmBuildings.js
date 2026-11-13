// OSM Buildings GeoJSON-Tiles (falls erreichbar), danach schmale OSM/Overpass-Abfrage.
// Ein Token für OSM Buildings gehört NICHT fest in ein öffentliches GitHub-Repository.
import {chooseBuildingFeature, buildingToModel} from '../../ar/buildingGeometry.js';

export const DEFAULT_TILE_TEMPLATE =
  'https://{s}.data.osmbuildings.org/0.2/anonymous/tile/{z}/{x}/{y}.json';

const RAD = Math.PI / 180;
const TILE_ZOOM = 15;
const MAX_TILES = 9;
const HTTP_TIMEOUT_MS = 14000;

function tileAt(lat, lon, zoom) {
  const n = 2 ** zoom;
  const clampedLat = Math.max(-85, Math.min(85, lat));
  const x = Math.max(0, Math.min(n - 1, Math.floor((lon + 180) / 360 * n)));
  const y = Math.max(0, Math.min(n - 1,
    Math.floor((1 - Math.asinh(Math.tan(clampedLat * RAD)) / Math.PI) / 2 * n)));
  return {x, y, z: zoom};
}

function bboxAround(poi, radiusM) {
  const northSouth = radiusM / 111195;
  const eastWest = radiusM / (111195 * Math.max(0.15, Math.cos(poi.lat * RAD)));
  return [poi.lat - northSouth, poi.lon - eastWest, poi.lat + northSouth, poi.lon + eastWest];
}

export function tilesForPoi(poi, radiusM, zoom = TILE_ZOOM) {
  const [south, west, north, east] = bboxAround(poi, radiusM);
  const first = tileAt(north, west, zoom), last = tileAt(south, east, zoom);
  const tiles = [];
  for (let x = first.x; x <= last.x; x++) {
    for (let y = first.y; y <= last.y; y++) tiles.push({x, y, z: zoom});
  }
  return tiles.length <= MAX_TILES ? tiles : [];
}

export function overpassQuery(poi, radiusM) {
  const bbox = bboxAround(poi, radiusM).map(num => num.toFixed(7)).join(',');
  return `[out:json][timeout:18];(way["building"](${bbox});relation["building"](${bbox});way["building:part"](${bbox});relation["building:part"](${bbox}););out geom;`;
}

async function requestJson(fetchFn, url, options = {}, timeoutMs = HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {...options, signal: controller.signal});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function createOSMBuildingsProvider({
  tileTemplate = DEFAULT_TILE_TEMPLATE,
  overpassEndpoint = 'https://overpass-api.de/api/interpreter',
  fetchFn = globalThis.fetch?.bind(globalThis),
  maxTileCache = 24,
  now = () => Date.now(),
} = {}) {
  if (!fetchFn) throw new Error('Fetch API nicht verfügbar.');
  const tileCache = new Map();
  let tilesUnavailableUntil = 0;

  function tileUrl(tile) {
    const subdomain = ['a', 'b', 'c', 'd'][(tile.x + tile.y) % 4];
    return tileTemplate.replaceAll('{s}', subdomain)
      .replaceAll('{z}', String(tile.z))
      .replaceAll('{x}', String(tile.x))
      .replaceAll('{y}', String(tile.y));
  }

  function fetchTile(tile) {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    if (tileCache.has(key)) {
      const entry = tileCache.get(key);
      tileCache.delete(key);
      tileCache.set(key, entry);
      return entry;
    }
    const promise = requestJson(fetchFn, tileUrl(tile)).then(data => {
      if (!data || !Array.isArray(data.features)) throw new Error('Ungültige OSM-Buildings-Tile-Antwort.');
      return data.features;
    }).catch(error => {
      tileCache.delete(key);
      throw error;
    });
    tileCache.set(key, promise);
    while (tileCache.size > maxTileCache) tileCache.delete(tileCache.keys().next().value);
    return promise;
  }

  async function fromTiles(poi, options) {
    if (!tileTemplate || now() < tilesUnavailableUntil) return null;
    const tiles = tilesForPoi(poi, options.searchRadiusM);
    if (!tiles.length) return null;
    try {
      // Gemeinsam benötigte Tiles sind auch während laufender Abrufe dedupliziert.
      const responses = await Promise.all(tiles.map(fetchTile));
      const features = [...new Map(responses.flat().map(f => [String(f.id ?? `${f.geometry?.type}:${JSON.stringify(f.geometry?.coordinates?.[0]?.[0])}`), f])).values()];
      return chooseBuildingFeature(features, poi, options);
    } catch (_error) {
      // Nicht jeden POI erneut an einen nicht erreichbaren Tile-Server schicken.
      tilesUnavailableUntil = now() + 10 * 60 * 1000;
      return null;
    }
  }

  async function fromOverpass(poi, options) {
    const body = new URLSearchParams({data: overpassQuery(poi, options.searchRadiusM)});
    const result = await requestJson(fetchFn, overpassEndpoint, {
      method: 'POST', body,
    }, 22000);
    if (!Array.isArray(result?.elements)) throw new Error('Overpass: ungültige Antwort.');
    return chooseBuildingFeature(result.elements, poi, options);
  }

  return {
    async load(poi) {
      const options = {searchRadiusM: poi.building?.searchRadiusM ?? 150, osmId: poi.building?.osmId ?? null};
      let selected = await fromTiles(poi, options);
      let provider = 'OSM Buildings';
      if (!selected) {
        selected = await fromOverpass(poi, options);
        provider = 'OpenStreetMap (Overpass-Fallback)';
      }
      if (!selected) return null;
      const model = buildingToModel(selected, poi, {defaultHeight: poi.building?.defaultHeight ?? 12});
      return model ? {...model, provider} : null;
    },
    get cacheSize() { return tileCache.size; },
    clearCache() { tileCache.clear(); },
  };
}
