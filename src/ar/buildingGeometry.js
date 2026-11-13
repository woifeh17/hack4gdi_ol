// OpenStreetMap/OSM Buildings GeoJSON -> drahtgittertaugliche lokale ENU-Geometrie.
// Koordinaten: [Ost, Nord, Oben] in Metern, relativ zum POI-Anker.
const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;
const EPS = 1e-7;

const distance2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
const samePoint = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

export function lonLatToEnu(lon, lat, anchor) {
  return [
    (lon - anchor.lon) * RAD * EARTH_RADIUS * Math.cos(anchor.lat * RAD),
    (lat - anchor.lat) * RAD * EARTH_RADIUS,
  ];
}

function closedRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const points = ring
    .filter(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(p => [p[0], p[1]]);
  if (points.length >= 2 && samePoint(points[0], points.at(-1))) points.pop();
  return points.length >= 3 ? points : null;
}

function fromGeometry(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

// Relationen können auf mehrere OSM-Ways verteilte Außenringe enthalten.
function joinWaySegments(segments) {
  const pending = segments.map(closed => closed.map(p => [p[0], p[1]]));
  const complete = [];
  while (pending.length) {
    let current = pending.shift();
    if (current.length < 2) continue;
    for (let attempt = 0; attempt < segments.length * 2 && !samePoint(current[0], current.at(-1)); attempt++) {
      const index = pending.findIndex(part => {
        const tail = current.at(-1);
        return samePoint(tail, part[0]) || samePoint(tail, part.at(-1));
      });
      if (index < 0) break;
      let next = pending.splice(index, 1)[0];
      if (samePoint(current.at(-1), next.at(-1))) next.reverse();
      current.push(...next.slice(1));
    }
    const ring = closedRing(current);
    if (ring && (samePoint(current[0], current.at(-1)) || segments.length === 1)) complete.push(ring);
  }
  return complete;
}

export function normalizeBuildingFeature(feature) {
  const tags = feature?.properties ?? feature?.tags ?? {};
  let polygons = [];
  if (feature?.type === 'Feature') {
    polygons = fromGeometry(feature.geometry).map(rings => rings.map(closedRing).filter(Boolean)).filter(rings => rings.length);
  } else if (feature?.type === 'way' && Array.isArray(feature.geometry)) {
    const ring = closedRing(feature.geometry.map(p => [p.lon, p.lat]));
    if (ring) polygons = [[ring]];
  } else if (feature?.type === 'relation' && Array.isArray(feature.members)) {
    const members = feature.members.filter(m => Array.isArray(m.geometry));
    const outer = joinWaySegments(members.filter(m => m.role === 'outer').map(m => m.geometry.map(p => [p.lon, p.lat])));
    const inner = joinWaySegments(members.filter(m => m.role === 'inner').map(m => m.geometry.map(p => [p.lon, p.lat])));
    // Löcher werden dem jeweils einschließenden Außenring zugeordnet.
    polygons = outer.map(ring => [ring, ...inner.filter(hole => pointInRing(hole[0], ring))]);
  }
  if (!polygons.length) return null;
  return {id: String(feature.id ?? tags.id ?? ''), tags, polygons};
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > point[1]) !== (yj > point[1]) &&
        point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInsidePolygon(point, rings) {
  return pointInRing(point, rings[0]) && !rings.slice(1).some(hole => pointInRing(point, hole));
}

function segmentDistance(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1)));
  return Math.sqrt(distance2(p, [a[0] + vx * t, a[1] + vy * t]));
}

function boundaryDistance(point, rings, anchor) {
  let closest = Infinity;
  for (const ring of rings) {
    const local = ring.map(([lon, lat]) => lonLatToEnu(lon, lat, anchor));
    for (let i = 0; i < local.length; i++) {
      closest = Math.min(closest, segmentDistance([0, 0], local[i], local[(i + 1) % local.length]));
    }
  }
  return closest;
}

function tagNumber(tags, keys) {
  for (const key of keys) {
    const value = String(tags[key] ?? '').replace(',', '.');
    const match = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:m|meter|metres?)?\s*$/i);
    if (match) return Number(match[1]);
  }
  return null;
}

export function buildingHeights(tags, defaultHeight = 12) {
  const levels = tagNumber(tags, ['building:levels', 'levels']);
  const roof = tagNumber(tags, ['roof:height', 'roofHeight']);
  const roofLevels = tagNumber(tags, ['roof:levels']);
  const roofHeight = Math.max(0, Math.min(35, roof ?? (roofLevels == null ? 0 : roofLevels * 3)));
  const height = Math.max(2, Math.min(350,
    tagNumber(tags, ['height', 'building:height']) ?? (levels == null ? defaultHeight : levels * 3 + roofHeight)));
  const minLevels = tagNumber(tags, ['building:min_level', 'min_level']);
  const minHeight = Math.max(0, Math.min(height - 0.5,
    tagNumber(tags, ['min_height', 'minHeight', 'building:min_height']) ?? (minLevels == null ? 0 : minLevels * 3)));
  return {height, minHeight, roofHeight: Math.min(roofHeight, height - minHeight - 0.5)};
}

// Ein Feature wählen, statt jedes Gebäude der geladenen Kachel im AR-Fenster zu zeichnen.
export function chooseBuildingFeature(rawFeatures, poi, {searchRadiusM = 150, osmId = null} = {}) {
  const features = rawFeatures.map(normalizeBuildingFeature).filter(Boolean);
  const target = [poi.lon, poi.lat];
  const normalizedId = osmId == null ? null : String(osmId).replace(/^(way|relation)\//, '');
  if (normalizedId) {
    const match = features.find(f => f.id.replace(/^(way|relation)\//, '') === normalizedId);
    if (match) return match;
  }
  const matches = features.map(feature => {
    const inside = feature.polygons.some(rings => pointInsidePolygon(target, rings));
    const distance = Math.min(...feature.polygons.map(rings => boundaryDistance(target, rings, poi)));
    const featureName = String(feature.tags.name ?? '').toLowerCase();
    const poiName = String(poi.name ?? '').toLowerCase();
    const named = featureName.length > 3 && (poiName.includes(featureName) || featureName.includes(poiName));
    const isPart = Boolean(feature.tags['building:part']);
    // Benannte, große Bauwerke bevorzugen; bei mehreren Kandidaten Nähe entscheiden lassen.
    return {feature, inside, distance, score: (inside ? 550 : 0) + (named ? 250 : 0) - distance - (isPart ? 80 : 0)};
  }).filter(item => item.inside || item.distance <= searchRadiusM);
  matches.sort((a, b) => b.score - a.score);
  return matches[0]?.feature ?? null;
}

function addEdges(vertices, edges, ring, minHeight, eaveHeight, anchor) {
  const bottom = [], top = [];
  for (const [lon, lat] of ring) {
    const [east, north] = lonLatToEnu(lon, lat, anchor);
    bottom.push(vertices.push([east, north, minHeight]) - 1);
    top.push(vertices.push([east, north, eaveHeight]) - 1);
  }
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    edges.push([bottom[i], bottom[next]], [top[i], top[next]], [bottom[i], top[i]]);
  }
  return top;
}

// Eine nachweisbar unterstützte LOD2-Annäherung: gabled/Satteldach auf 4-eckigem Grundriss.
function addSimpleGable(vertices, edges, topIndices, roofHeight) {
  if (topIndices.length !== 4 || roofHeight < 0.1) return false;
  const pts = topIndices.map(index => vertices[index]);
  const lengths = pts.map((p, i) => Math.sqrt(distance2(p, pts[(i + 1) % 4])));
  const oppositeSimilar = Math.abs(lengths[0] - lengths[2]) < Math.max(lengths[0], lengths[2]) * 0.3 &&
    Math.abs(lengths[1] - lengths[3]) < Math.max(lengths[1], lengths[3]) * 0.3;
  if (!oppositeSimilar) return false;
  const horizontalLong = lengths[0] + lengths[2] >= lengths[1] + lengths[3];
  const pair1 = horizontalLong ? [0, 3] : [0, 1];
  const pair2 = horizontalLong ? [1, 2] : [2, 3];
  const midpoint = ([a, b]) => [
    (pts[a][0] + pts[b][0]) / 2,
    (pts[a][1] + pts[b][1]) / 2,
    (pts[a][2] + pts[b][2]) / 2 + roofHeight,
  ];
  const a = vertices.push(midpoint(pair1)) - 1;
  const b = vertices.push(midpoint(pair2)) - 1;
  edges.push([a, b]);
  for (const corner of pair1) edges.push([topIndices[corner], a]);
  for (const corner of pair2) edges.push([topIndices[corner], b]);
  return true;
}

export function buildingToModel(feature, poi, {defaultHeight = 12, maxVertices = 1500} = {}) {
  if (!feature?.polygons?.length) return null;
  const {height, minHeight, roofHeight} = buildingHeights(feature.tags, defaultHeight);
  const shape = String(feature.tags['roof:shape'] ?? feature.tags.roofShape ?? '').toLowerCase();
  const vertices = [], edges = [];
  let lod = 1;
  for (const polygon of feature.polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const ring = polygon[i];
      if (vertices.length + ring.length * 2 > maxVertices) return null;
      // Nur bei rechteckigen Satteldächern wird eine Dachform approximiert.
      const gable = i === 0 && shape === 'gabled' && ring.length === 4 && roofHeight > 0;
      const top = addEdges(vertices, edges, ring, minHeight, gable ? height - roofHeight : height, poi);
      if (gable && addSimpleGable(vertices, edges, top, roofHeight)) lod = 2;
    }
  }
  if (!vertices.length) return null;
  return {vertices, edges, lod, source: 'OpenStreetMap / OSM Buildings', osmId: feature.id};
}

// Perspektivisch korrektes Clipping im Kameraraum: auch teilweise sichtbare Kanten bleiben sichtbar.
export function projectEnuEdge(a, b, pose, horizontalFov, verticalFov) {
  if (!pose || !a || !b) return null;
  const dot = (v, axis) => v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
  const transform = point => [dot(point, pose.right), dot(point, pose.up), dot(point, pose.forward)];
  const p0 = transform(a), p1 = transform(b);
  const tanH = Math.tan(horizontalFov * RAD / 2), tanV = Math.tan(verticalFov * RAD / 2);
  if (!(tanH > 0 && tanV > 0)) return null;
  let lo = 0, hi = 1;
  // Halbebenen: nahe Ebene, linke/rechte sowie obere/untere Sichtfeldgrenzen.
  const planes = [
    ([x,y,z]) => z - 0.1,
    ([x,y,z]) => x + z * tanH,
    ([x,y,z]) => -x + z * tanH,
    ([x,y,z]) => y + z * tanV,
    ([x,y,z]) => -y + z * tanV,
  ];
  for (const plane of planes) {
    const v0 = plane(p0), v1 = plane(p1);
    if (v0 < 0 && v1 < 0) return null;
    if (v0 >= 0 && v1 >= 0) continue;
    const t = v0 / (v0 - v1);
    if (v0 < 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
    if (hi < lo) return null;
  }
  const projected = t => {
    const p = p0.map((v, i) => v + (p1[i] - v) * t);
    return {x: 0.5 + p[0] / (2 * p[2] * tanH), y: 0.5 - p[1] / (2 * p[2] * tanV)};
  };
  return [projected(lo), projected(hi)];
}
