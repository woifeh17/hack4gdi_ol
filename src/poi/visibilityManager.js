// Welche POIs sollen beim Vorbeifahren vorgeladen werden?
// Die eigentliche AR-Projektion bleibt unabhängig davon.
import {distanceAndBearing, normalize360} from '../ar/geometry.js';
import {BUILDING_PRELOAD_DISTANCE_M, MAX_BUILDING_PRELOAD_COUNT} from '../ar/visibilityConfig.js';

export function selectRelevantBuildings(pois, position, camera, {
  maxDistanceM = BUILDING_PRELOAD_DISTANCE_M,
  preloadAngle = 105,
  maxCount = MAX_BUILDING_PRELOAD_COUNT,
} = {}) {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lon)) return [];
  const heading = Number.isFinite(camera?.heading) ? camera.heading : null;
  return pois.filter(poi => poi.building?.enabled).map(poi => {
    const relative = distanceAndBearing(position.lat, position.lon, poi.lat, poi.lon);
    if (!relative) return null;
    const delta = heading == null || relative.bearing == null ? 0 : Math.abs(normalize360(relative.bearing - heading + 180) - 180);
    if (relative.distance > maxDistanceM || (heading != null && delta > preloadAngle)) return null;
    return {poi, distance: relative.distance, bearingDelta: delta};
  }).filter(Boolean).sort((a, b) => (a.distance + a.bearingDelta * 7) - (b.distance + b.bearingDelta * 7))
    .slice(0, maxCount).map(item => item.poi);
}

export function createBuildingStream(pois, provider, {
  onStatus = () => {}, maxModels = 8, maxConcurrent = 2,
  updateEveryMs = 1200, retryAfterMs = 60000,
  now = () => Date.now(),
} = {}) {
  const models = new Map();
  const pending = new Set();
  const failures = new Map();
  const queue = [];
  let lastUpdate = -Infinity;
  let active = 0;

  function emit() {
    onStatus({loaded: models.size, loading: pending.size, errors: failures.size});
  }

  function evict() {
    while (models.size > maxModels) models.delete(models.keys().next().value);
  }

  function pump() {
    while (active < maxConcurrent && queue.length) {
      const poi = queue.shift();
      if (!pending.has(poi.id)) continue;
      active++;
      Promise.resolve().then(() => provider.load(poi)).then(model => {
        if (model) {
          models.delete(poi.id);
          models.set(poi.id, model);
          evict();
        } else failures.set(poi.id, now());
      }).catch(() => failures.set(poi.id, now()))
        .finally(() => {
          pending.delete(poi.id);
          active--;
          emit();
          pump();
        });
    }
  }

  function schedule(poi) {
    if (models.has(poi.id) || pending.has(poi.id)) return;
    if (now() - (failures.get(poi.id) ?? -Infinity) < retryAfterMs) return;
    failures.delete(poi.id);
    pending.add(poi.id);
    queue.push(poi);
    emit();
    pump();
  }

  return {
    update(frame) {
      if (now() - lastUpdate < updateEveryMs) return;
      lastUpdate = now();
      const relevant = selectRelevantBuildings(pois, frame.position, frame.camera);
      relevant.forEach(schedule);
    },
    getModel(poi) {
      const model = models.get(poi.id);
      if (model) { // LRU-Zugriff
        models.delete(poi.id);
        models.set(poi.id, model);
      }
      return model ?? poi.model ?? null;
    },
    getStatus(poi) {
      if (models.has(poi.id)) return 'loaded';
      if (pending.has(poi.id)) return 'loading';
      if (failures.has(poi.id)) return 'unavailable';
      return 'idle';
    },
    get counts() { return {loaded: models.size, pending: pending.size, errors: failures.size}; },
  };
}
