// Build shaded LOD1/limited LOD2 geometry from a *real* OSM footprint.
// Coordinates remain ENU metres relative to the POI anchor.
import {buildingHeights, lonLatToEnu} from './buildingGeometry.js';

function area(ring, poi) {
  const xy = ring.map(([lon, lat]) => lonLatToEnu(lon, lat, poi));
  return xy.reduce((sum, p, i) => {
    const q = xy[(i + 1) % xy.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
}

function ringWithWinding(ring, poi, outer) {
  // Outer CCW; holes CW. Wall normals then point outwards from solid material.
  const current = area(ring, poi);
  return (current > 0) === outer ? ring : [...ring].reverse();
}

function midpoint(a, b, elevation) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, elevation];
}

function gablePairs(xy) {
  if (xy.length !== 4) return null;
  const lengths = xy.map((p, i) => Math.hypot(
    p[0] - xy[(i + 1) % 4][0], p[1] - xy[(i + 1) % 4][1]
  ));
  const compatible = Math.abs(lengths[0] - lengths[2]) < Math.max(lengths[0], lengths[2]) * 0.3 &&
    Math.abs(lengths[1] - lengths[3]) < Math.max(lengths[1], lengths[3]) * 0.3;
  if (!compatible) return null;
  return lengths[0] + lengths[2] >= lengths[1] + lengths[3]
    ? [[0, 3], [1, 2]] : [[0, 1], [2, 3]];
}

export function meshFromBuildingFeature(feature, poi, {defaultHeight = 12, maxVertices = 1500} = {}) {
  if (!feature?.polygons?.length) return null;
  const {height, minHeight, roofHeight} = buildingHeights(feature.tags ?? {}, defaultHeight);
  const shape = String(feature.tags?.['roof:shape'] ?? '').toLowerCase();
  const vertices = [], edges = [], faces = [];
  let lod = 1;

  const addFace = (indices, surface) => faces.push({rings: [indices], surface});
  const addEdge = (a, b) => edges.push([a, b]);

  for (const polygon of feature.polygons) {
    if (!polygon.length) continue;
    const outerXY = ringWithWinding(polygon[0], poi, true)
      .map(([lon, lat]) => lonLatToEnu(lon, lat, poi));
    const pairs = polygon.length === 1 && shape === 'gabled' && roofHeight > 0
      ? gablePairs(outerXY) : null;
    const eave = pairs ? height - roofHeight : height;
    const roofRings = [];
    let topOuter = null;

    for (let ringIndex = 0; ringIndex < polygon.length; ringIndex++) {
      const ring = ringWithWinding(polygon[ringIndex], poi, ringIndex === 0);
      if (ring.length < 3 || vertices.length + ring.length * 2 + (pairs ? 2 : 0) > maxVertices) return null;
      const bottom = [], top = [];
      for (const [lon, lat] of ring) {
        const [x, y] = lonLatToEnu(lon, lat, poi);
        bottom.push(vertices.push([x, y, minHeight]) - 1);
        top.push(vertices.push([x, y, eave]) - 1);
      }
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        addFace([bottom[i], bottom[j], top[j], top[i]], 'wall');
        addEdge(bottom[i], bottom[j]);
        addEdge(top[i], top[j]);
        addEdge(bottom[i], top[i]);
      }
      roofRings.push(top);
      if (ringIndex === 0) topOuter = top;
    }

    if (pairs && topOuter?.length === 4) {
      const p = topOuter.map(i => vertices[i]);
      const a = vertices.push(midpoint(p[pairs[0][0]], p[pairs[0][1]], height)) - 1;
      const b = vertices.push(midpoint(p[pairs[1][0]], p[pairs[1][1]], height)) - 1;
      addEdge(a, b);
      for (const i of pairs[0]) addEdge(topOuter[i], a);
      for (const i of pairs[1]) addEdge(topOuter[i], b);
      if (pairs[0][1] === 3) {
        addFace([topOuter[3], topOuter[0], a], 'wall');
        addFace([topOuter[1], topOuter[2], b], 'wall');
        addFace([topOuter[0], topOuter[1], b, a], 'roof');
        addFace([topOuter[2], topOuter[3], a, b], 'roof');
      } else {
        addFace([topOuter[0], topOuter[1], a], 'wall');
        addFace([topOuter[2], topOuter[3], b], 'wall');
        addFace([topOuter[1], topOuter[2], b, a], 'roof');
        addFace([topOuter[3], topOuter[0], a, b], 'roof');
      }
      lod = 2;
    } else {
      // Multiple rings use Canvas2D's even-odd fill: courtyards remain open.
      faces.push({rings: roofRings, surface: 'roof'});
    }
  }

  if (!vertices.length) return null;
  return {
    vertices, edges, faces, lod,
    heightSource: feature.tags?.height || feature.tags?.['building:height']
      ? 'OSM height' : feature.tags?.['building:levels']
        ? 'OSM levels estimate' : 'default estimate',
    source: 'OpenStreetMap / Geofabrik',
    osmId: feature.id,
  };
}
