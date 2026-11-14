import {distanceAndBearing} from '../../ar/geometry.js';

const RAD = Math.PI / 180;
const TILE_LIMIT = 24;
const ASSET_ROOT = './assets/buildings/lod2/';

export function applyLod2Manifest(pois, manifest) {
  if (manifest?.version !== 1) return 0;
  let count = 0;
  for (const poi of pois) {
    const links = manifest.pois?.[poi.id];
    if (!Array.isArray(links) || !links.length) continue;
    if (!links.every(link => Array.isArray(link) && link.length === 2 && typeof link[1] === 'string')) continue;
    const refs = links.map(([tile, id]) => ({file: manifest.tiles?.[tile], id}));
    if (!refs.every(({file}) => /^\d+-\d+-\d+-[a-f0-9]{16}\.json$/.test(file))) continue;
    poi.building = {...poi.building, enabled: true, lod2: refs};
    count++;
  }
  return count;
}

function assemble(parts, poi) {
  const baseHeight = Math.min(...parts.map(part => part.origin[2]));
  const vertices = [];
  const faces = [];
  for (const {origin: [lon, lat, height], vertices: points, triangles} of parts) {
    const {distance, bearing} = distanceAndBearing(poi.lat, poi.lon, lat, lon);
    const east = distance * Math.sin(bearing * RAD);
    const north = distance * Math.cos(bearing * RAD);
    const start = vertices.length;
    for (const [x, y, z] of points) vertices.push([x + east, y + north, z + height - baseHeight]);
    for (const [roof, a, b, c] of triangles) {
      faces.push({surface: roof ? 'roof' : 'wall', rings: [[a + start, b + start, c + start]]});
    }
  }
  return {vertices, faces, lod: 2, triangulated: true};
}

export function createLod2BuildingProvider(fallback, {
  fetchFn = globalThis.fetch?.bind(globalThis),
  baseUrl = globalThis.document?.baseURI ?? 'https://example.invalid/',
} = {}) {
  const tiles = new Map();

  function loadTile(file) {
    const cached = tiles.get(file);
    if (cached) {
      tiles.delete(file);
      tiles.set(file, cached);
      return cached;
    }
    const request = fetchFn(new URL(ASSET_ROOT + file, baseUrl).href, {signal: AbortSignal.timeout(20000)}).then(async response => {
      if (!response.ok) throw new Error(`LoD2 tile ${file}: HTTP ${response.status}`);
      const tile = await response.json();
      if (tile.version !== 1 || !tile.buildings) throw new Error(`Invalid LoD2 tile ${file}`);
      return tile.buildings;
    }).catch(error => {
      if (tiles.get(file) === request) tiles.delete(file);
      throw error;
    });
    tiles.set(file, request);
    if (tiles.size > TILE_LIMIT) tiles.delete(tiles.keys().next().value);
    return request;
  }

  return {
    async load(poi) {
      if (poi.building?.lod2?.length) {
        try {
          const parts = await Promise.all(poi.building.lod2.map(async ({file, id}) => {
            const part = (await loadTile(file))[id];
            if (!part) throw new Error(`Missing building ${id} in ${file}`);
            return part;
          }));
          return assemble(parts, poi);
        } catch (error) {
          if (!poi.building.url) throw error;
          console.warn(`LoD2 unavailable for ${poi.id}; using OSM geometry`, error);
        }
      }
      return fallback.load(poi);
    },
  };
}
