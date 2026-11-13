import {projectEnuEdge} from './buildingGeometry.js';

const RAD = Math.PI / 180;
const SUN = [-0.45, 0.6, 0.65]; // fixed light direction, ENU
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const sub = (a, b) => a.map((v,i) => v-b[i]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function faceNormal(vertices, indices) {
  const p = vertices[indices[0]];
  if (!p) return null;
  for (let k = 1; k + 1 < indices.length; k++) {
    const a = vertices[indices[k]], b = vertices[indices[k+1]];
    if (!a || !b) return null;
    const n = cross(sub(a,p), sub(b,p));
    const len = Math.hypot(...n);
    if (len > 0.00001) return n.map(v => v/len);
  }
  return null;
}

// Sutherland-Hodgman clipping against near, left/right and top/bottom planes.
export function clipProjectedPolygon(points, pose, horizontalFov, verticalFov) {
  if (!points?.length || !pose || !(horizontalFov > 0 && horizontalFov < 179) ||
      !(verticalFov > 0 && verticalFov < 179)) return [];
  const h = Math.tan(horizontalFov * RAD / 2);
  const v = Math.tan(verticalFov * RAD / 2);
  let polygon = points.map(p => [dot(p,pose.right), dot(p,pose.up), dot(p,pose.forward)]);
  const planes = [
    p => p[2] - 0.1, p => p[0] + p[2]*h, p => -p[0] + p[2]*h,
    p => p[1] + p[2]*v, p => -p[1] + p[2]*v,
  ];
  for (const plane of planes) {
    if (!polygon.length) break;
    const output = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i+1) % polygon.length];
      const da = plane(a), db = plane(b);
      const insideA = da >= 0, insideB = db >= 0;
      if (insideA) output.push(a);
      if (insideA !== insideB) {
        const t = da / (da-db);
        output.push(a.map((value,j) => value + t*(b[j]-value)));
      }
    }
    polygon = output;
  }
  return polygon.map(([x,y,z]) => ({
    x: 0.5 + x/(2*z*h), y: 0.5-y/(2*z*v), depth: z,
  }));
}

function toWorldVertices(model, candidate) {
  const {relative, up} = candidate;
  const bearing = (relative.bearing ?? 0) * RAD;
  const east = Math.sin(bearing) * relative.distance;
  const north = Math.cos(bearing) * relative.distance;
  return model.vertices.map(([x,y,z]) => [east+x, north+y, up+z]);
}

function shade(surface, normal) {
  // Stable directional light + ambient illumination, no external WebGL dependency.
  const intensity = clamp(0.54 + 0.42 * dot(normal,SUN), 0.26, 0.96);
  const base = surface === 'roof' ? [106,181,171] : [78,166,161];
  const [r,g,b] = base.map(v => Math.round(v*intensity));
  return `rgba(${r},${g},${b},0.80)`;
}

export function projectBuilding(model, candidate, pose, fieldOfView) {
  if (!model?.vertices?.length) return null;
  const vertices = toWorldVertices(model, candidate);
  if (!model.faces?.length) {
    return model.edges?.length ? {polygons: [], anchor: null, wire: {vertices, model}} : null;
  }

  const polygons = [];
  let anchor = null;
  let largestArea = 0;
  for (const face of model.faces) {
    const outer = face.rings?.[0];
    if (!outer || outer.length < 3) continue;
    const normal = faceNormal(vertices, outer);
    if (!normal || dot(normal, vertices[outer[0]]) >= 0) continue;

    const clipped = face.rings.map(ring => clipProjectedPolygon(
      ring.map(i => vertices[i]), pose, ...fieldOfView
    ));
    const outline = clipped[0];
    if (outline.length < 3) continue;

    // Use the center of the largest clipped face as an alternate label anchor.
    let twiceArea = 0;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      twiceArea += a.x * b.y - b.x * a.y;
    }
    const area = Math.abs(twiceArea);
    if (area <= 1e-10) continue;
    if (area > largestArea) {
      largestArea = area;
      anchor = {
        x: outline.reduce((sum, point) => sum + point.x, 0) / outline.length,
        y: outline.reduce((sum, point) => sum + point.y, 0) / outline.length,
      };
    }
    const depth = outline.reduce((sum, point) => sum + point.depth, 0) / outline.length;
    polygons.push({
      rings: clipped.filter(ring => ring.length >= 3),
      depth, color: shade(face.surface, normal), outline: !model.triangulated,
    });
  }
  return {polygons, anchor};
}

export function drawShadedBuildings(ctx, buildings, pose, fieldOfView, screenX, screenY) {
  const polygons = buildings.flatMap(building => building.polygons);
  // Draw all accepted buildings in shared depth order.
  polygons.sort((a,b) => b.depth-a.depth);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = 'rgba(207,250,238,0.43)';
  for (const face of polygons) {
    ctx.beginPath();
    for (const ring of face.rings) {
      ctx.moveTo(screenX(ring[0]), screenY(ring[0]));
      for (let j=1;j<ring.length;j++) ctx.lineTo(screenX(ring[j]), screenY(ring[j]));
      ctx.closePath();
    }
    ctx.fillStyle = face.color;
    ctx.fill('evenodd');
    if (face.outline) ctx.stroke();
  }

  // Preserve legacy box placeholders as outlines, visually distinct from real footprints.
  ctx.strokeStyle = 'rgba(178,245,229,0.7)';
  ctx.lineWidth = 1.4;
  for (const {wire} of buildings) {
    if (!wire) continue;
    const {vertices, model} = wire;
    ctx.beginPath();
    for (const [a,b] of model.edges) {
      const projected = projectEnuEdge(vertices[a],vertices[b],pose,...fieldOfView);
      if (!projected) continue;
      ctx.moveTo(screenX(projected[0]),screenY(projected[0]));
      ctx.lineTo(screenX(projected[1]),screenY(projected[1]));
    }
    ctx.stroke();
  }
}
