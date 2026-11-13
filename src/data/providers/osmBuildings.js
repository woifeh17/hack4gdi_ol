
import {
  chooseBuildingFeature,
  buildingToModel
} from '../../ar/buildingGeometry.js';

// OSM Buildings ist derzeit wegen HTTP 403 deaktiviert.
// Bei einem gültigen Zugang kann die Kachelvorlage
// wieder über tileTemplate aktiviert werden.
export const DEFAULT_TILE_TEMPLATE = null;

export const OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter'
];

const RAD = Math.PI / 180;
const TILE_ZOOM = 15;
const MAX_TILES = 9;
const HTTP_TIMEOUT_MS = 22000;
const RETRY_CODES = new Set([429, 502, 503, 504]);

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function readableError(error) {
  if (error?.name === 'AbortError') {
    return 'Timeout: Server antwortet nicht rechtzeitig';
  }
  return `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
}

function tileAt(lat, lon, zoom) {
  const n = 2 ** zoom;
  const clampedLat = Math.max(-85, Math.min(85, lat));

  const x = Math.max(
    0,
    Math.min(n - 1, Math.floor((lon + 180) / 360 * n))
  );

  const y = Math.max(
    0,
    Math.min(n - 1, Math.floor(
      (1 - Math.asinh(Math.tan(clampedLat * RAD)) / Math.PI) / 2 * n
    ))
  );

  return {x, y, z: zoom};
}

function bboxAround(poi, radiusM) {
  const northSouth = radiusM / 111195;
  const eastWest = radiusM /
    (111195 * Math.max(0.15, Math.cos(poi.lat * RAD)));

  return [
    poi.lat - northSouth,
    poi.lon - eastWest,
    poi.lat + northSouth,
    poi.lon + eastWest
  ];
}

export function tilesForPoi(poi, radiusM, zoom = TILE_ZOOM) {
  const [south, west, north, east] = bboxAround(poi, radiusM);

  const first = tileAt(north, west, zoom);
  const last = tileAt(south, east, zoom);

  const tiles = [];

  for (let x = first.x; x <= last.x; x++) {
    for (let y = first.y; y <= last.y; y++) {
      tiles.push({x, y, z: zoom});
    }
  }

  return tiles.length <= MAX_TILES ? tiles : [];
}

export function overpassQuery(poi, radiusM) {
  const bbox = bboxAround(poi, radiusM)
    .map(value => value.toFixed(7))
    .join(',');

  return `[out:json][timeout:18];
(
  way["building"](${bbox});
  relation["building"](${bbox});
  way["building:part"](${bbox});
  relation["building:part"](${bbox});
);
out geom;`;
}

async function requestJson(
  fetchFn,
  url,
  options = {},
  timeoutMs = HTTP_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(url, {
      ...options,
      signal: controller.signal
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function shouldRetry(error) {
  if (RETRY_CODES.has(error?.status)) return true;

  // Browser-Fetch meldet Netzwerk- und häufig auch
  // CORS-Fehler als TypeError.
  if (error instanceof TypeError) return true;

  if (error?.name === 'AbortError') return true;

  return false;
}

export function createOSMBuildingsProvider({
  tileTemplate = DEFAULT_TILE_TEMPLATE,
  overpassEndpoints = OVERPASS_ENDPOINTS,
  overpassEndpoint = null,
  fetchFn = globalThis.fetch?.bind(globalThis),
  maxTileCache = 24,
  now = () => Date.now(),
  onDebug = () => {},
  retriesPerEndpoint = 1
} = {}) {
  if (!fetchFn) {
    throw new Error('Fetch API nicht verfügbar.');
  }

  // Unterstützt auch die alte Konfiguration
  // mit einem einzelnen overpassEndpoint.
  const endpoints = overpassEndpoint
    ? [overpassEndpoint]
    : [...overpassEndpoints];

  const tileCache = new Map();
  let tilesUnavailableUntil = 0;

  const report = (stage, details = {}) => {
    onDebug({stage, ...details});
  };

  function tileUrl(tile) {
    const subdomain = ['a', 'b', 'c', 'd'][
      (tile.x + tile.y) % 4
    ];

    return tileTemplate
      .replaceAll('{s}', subdomain)
      .replaceAll('{z}', String(tile.z))
      .replaceAll('{x}', String(tile.x))
      .replaceAll('{y}', String(tile.y));
  }

  function fetchTile(tile) {
    const key = `${tile.z}/${tile.x}/${tile.y}`;

    if (tileCache.has(key)) {
      const entry = tileCache.get(key);

      // LRU: Zuletzt benutzte Kachel nach hinten setzen.
      tileCache.delete(key);
      tileCache.set(key, entry);

      return entry;
    }

    const promise = requestJson(fetchFn, tileUrl(tile))
      .then(data => {
        if (!data || !Array.isArray(data.features)) {
          throw new Error('Ungültige OSM-Buildings-Tile-Antwort.');
        }

        return data.features;
      })
      .catch(error => {
        tileCache.delete(key);

        report('tile-error', {
          tile: key,
          error: readableError(error)
        });

        throw error;
      });

    tileCache.set(key, promise);

    while (tileCache.size > maxTileCache) {
      tileCache.delete(tileCache.keys().next().value);
    }

    return promise;
  }

  async function fromTiles(poi, options) {
    if (!tileTemplate) {
      report('tiles-disabled', {
        poi: poi.id,
        reason: 'OSM Buildings deaktiviert; Overpass wird verwendet'
      });
      return null;
    }

    if (now() < tilesUnavailableUntil) {
      report('tiles-circuit-open', {
        poi: poi.id
      });
      return null;
    }

    const tiles = tilesForPoi(poi, options.searchRadiusM);

    if (!tiles.length) {
      report('tiles-skipped', {
        poi: poi.id,
        reason: 'Zu viele Kacheln'
      });
      return null;
    }

    report('tiles-start', {
      poi: poi.id,
      count: tiles.length
    });

    try {
      const responses = await Promise.all(
        tiles.map(fetchTile)
      );

      const features = [
        ...new Map(
          responses.flat().map(feature => [
            String(feature.id ?? JSON.stringify(feature.geometry)),
            feature
          ])
        ).values()
      ];

      const selected = chooseBuildingFeature(
        features,
        poi,
        options
      );

      report(selected ? 'tiles-match' : 'tiles-no-match', {
        poi: poi.id,
        features: features.length
      });

      return selected;
    } catch (error) {
      tilesUnavailableUntil = now() + 10 * 60 * 1000;

      report('tiles-unavailable', {
        poi: poi.id,
        error: readableError(error)
      });

      return null;
    }
  }

  async function fromOverpass(poi, options) {
    const query = overpassQuery(
      poi,
      options.searchRadiusM
    );

    const body = new URLSearchParams({data: query});

    let lastError;

    for (let index = 0; index < endpoints.length; index++) {
      const endpoint = endpoints[index];

      for (let attempt = 0; attempt <= retriesPerEndpoint; attempt++) {
        report('overpass-start', {
          poi: poi.id,
          endpoint,
          attempt: attempt + 1
        });

        try {
          const result = await requestJson(
            fetchFn,
            endpoint,
            {
              method: 'POST',
              body
            },
            HTTP_TIMEOUT_MS
          );

          if (!Array.isArray(result?.elements)) {
            throw new Error('Overpass: ungültige Antwort.');
          }

          const selected = chooseBuildingFeature(
            result.elements,
            poi,
            options
          );

          report(
            selected ? 'overpass-match' : 'overpass-no-match',
            {
              poi: poi.id,
              endpoint,
              elements: result.elements.length
            }
          );

          // Erfolgreiche Antwort:
          // Auch wenn kein Gebäude gefunden wurde,
          // wird nicht derselbe Bereich erneut abgefragt.
          return selected;

        } catch (error) {
          lastError = error;

          report('overpass-error', {
            poi: poi.id,
            endpoint,
            attempt: attempt + 1,
            error: readableError(error)
          });

          if (
            !shouldRetry(error) ||
            attempt >= retriesPerEndpoint
          ) {
            break;
          }

          const delayMs = 800 * (attempt + 1);

          report('overpass-retry', {
            poi: poi.id,
            endpoint,
            delayMs
          });

          await sleep(delayMs);
        }
      }

      if (index < endpoints.length - 1) {
        report('overpass-fallback', {
          poi: poi.id,
          from: endpoint,
          to: endpoints[index + 1]
        });
      }
    }

    // Erst nach Fehlschlag aller Endpunkte abbrechen.
    throw lastError ?? new Error(
      'Kein Overpass-Endpunkt verfügbar.'
    );
  }

  return {
    async load(poi) {
      const options = {
        searchRadiusM: poi.building?.searchRadiusM ?? 150,
        osmId: poi.building?.osmId ?? null
      };

      report('building-load-start', {
        poi: poi.id,
        radiusM: options.searchRadiusM
      });

      let selected = await fromTiles(poi, options);
      let provider = 'OSM Buildings';

      if (!selected) {
        selected = await fromOverpass(poi, options);
        provider = 'OpenStreetMap (Overpass-Fallback)';
      }

      if (!selected) {
        report('building-missing', {
          poi: poi.id,
          reason: 'Kein passendes OSM-Gebäude gefunden'
        });

        return null;
      }

      const model = buildingToModel(
        selected,
        poi,
        {
          defaultHeight: poi.building?.defaultHeight ?? 12
        }
      );

      report(model ? 'model-ready' : 'model-error', {
        poi: poi.id,
        provider,
        vertices: model?.vertices?.length ?? 0,
        edges: model?.edges?.length ?? 0
      });

      return model
        ? {...model, provider}
        : null;
    },

    get cacheSize() {
      return tileCache.size;
    },

    clearCache() {
      tileCache.clear();
      tilesUnavailableUntil = 0;
    }
  };
}
