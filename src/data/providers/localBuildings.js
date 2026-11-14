import {chooseBuildingFeature} from '../../ar/buildingGeometry.js';
import {meshFromBuildingFeature} from '../../ar/meshGeometry.js';

// No live OSM/Overpass calls: everything comes from the same GitHub Pages origin.
export function createLocalBuildingProvider({
  fetchFn = globalThis.fetch?.bind(globalThis),
  baseUrl = globalThis.document?.baseURI ?? 'https://example.invalid/',
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('Fetch API unavailable');
  const pending = new Map();
  return {
    async load(poi) {
      const building = poi?.building;
      if (!building?.enabled || !building.url) return null;
      const url = new URL(building.url, baseUrl);
      if (url.origin !== new URL(baseUrl).origin) throw new Error('Building URL must be same-origin');
      if (!pending.has(url.href)) {
        const promise = fetchFn(url.href, {signal: AbortSignal.timeout(20000)}).then(response => {
          if (!response.ok) throw new Error(`Building ${poi.id}: HTTP ${response.status}`);
          return response.json();
        }).catch(error => {
          if (pending.get(url.href) === promise) pending.delete(url.href);
          throw error;
        });
        pending.set(url.href, promise);
        if (pending.size > 24) pending.delete(pending.keys().next().value);
      }
      const geojson = await pending.get(url.href);
      const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
      const selected = chooseBuildingFeature(features, poi, {
        osmId: building.osmId,
        searchRadiusM: building.searchRadiusM ?? 200,
      });
      if (!selected) return null;
      return meshFromBuildingFeature(selected, poi, {
        defaultHeight: building.defaultHeight ?? 12,
      });
    },
    clearCache() { pending.clear(); },
    get cacheSize() { return pending.size; },
  };
}
