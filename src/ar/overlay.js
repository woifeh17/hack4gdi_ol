import {distanceAndBearing, projectPoi} from './geometry.js';
import {drawShadedBuildings, projectBuilding} from './shadedBuildings.js';
import {MAX_POI_DISTANCE_M as MAX_DISTANCE_M, MAX_VISIBLE_POIS} from './visibilityConfig.js';
import {poiScore} from './poiScore.js';
import {formatPoiDistance} from './formatDistance.js';

const RAD = Math.PI / 180;

const COLLISION_GAP_PX = 10;
const SCREEN_MARGIN_PX = 6;
const POINT_RADIUS_PX = 4;
const LABEL_OFFSET_PX = 16;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function overlaps(a, b) {
  const gap = COLLISION_GAP_PX;
  return a.left < b.right + gap && a.right + gap > b.left &&
    a.top < b.bottom + gap && a.bottom + gap > b.top;
}

function drawPointMarker(ctx, {anchorX, anchorY, rect, side}) {
  const labelX = clamp(anchorX, rect.left + POINT_RADIUS_PX, rect.right - POINT_RADIUS_PX);
  const labelY = side === 'above' ? rect.bottom : rect.top;

  ctx.strokeStyle = '#102928';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(anchorX, anchorY);
  ctx.lineTo(labelX, labelY);
  ctx.stroke();
  ctx.strokeStyle = '#b2f5e5';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(anchorX, anchorY, POINT_RADIUS_PX, 0, 2 * Math.PI);
  ctx.fillStyle = '#b2f5e5';
  ctx.fill();
  ctx.strokeStyle = '#102928';
  ctx.stroke();
}

export function createOverlay(
  canvas,
  markers,
  entries,
  onScan,
  video,
  getModel = poi => poi.model,
  {showDistance = () => false} = {}
) {
  const ctx = canvas.getContext('2d');
  markers.replaceChildren();

  const labels = entries.map(poi => {
    const button = document.createElement('button');
    button.className = 'marker';
    button.hidden = true;

    const name = document.createElement('span');
    name.className = 'marker__name';
    name.textContent = poi.name;

    const distance = document.createElement('span');
    distance.className = 'marker__distance';
    distance.hidden = true;

    button.append(name, distance);
    button.addEventListener('click', () => onScan(poi));
    markers.append(button);
    return {button, distance};
  });

  let lastPosition = null;
  let offsets = [];
  let previouslyVisible = new Map();

  return ({position, camera}, fieldOfView) => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const scale = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const {button} of labels) button.hidden = true;
    if (!position || !camera) {
      previouslyVisible.clear();
      return;
    }

    if (position !== lastPosition) {
      offsets = entries.map(poi =>
        distanceAndBearing(position.lat, position.lon, poi.lat, poi.lon)
      );
      lastPosition = position;
    }

    const videoAspect = video.classList.contains('active') && video.videoHeight
      ? video.videoWidth / video.videoHeight : width / height;
    const frameWidth = Math.min(width, height * videoAspect);
    const frameHeight = Math.min(height, width / videoAspect);
    const frameLeft = (width - frameWidth) / 2;
    const frameTop = (height - frameHeight) / 2;
    const screenX = point => frameLeft + point.x * frameWidth;
    const screenY = point => frameTop + point.y * frameHeight;

    const candidates = [];
    entries.forEach((poi, index) => {
      const relative = offsets[index];
      if (!relative || relative.distance > MAX_DISTANCE_M) return;

      const up = Number.isFinite(poi.altitude) && Number.isFinite(position.altitude)
        ? poi.altitude - position.altitude : 0;
      const elevation = Math.atan2(up, relative.distance) / RAD;
      const building = projectBuilding(getModel(poi), {relative, up}, camera, fieldOfView);
      const point = projectPoi(relative.bearing, elevation, camera, ...fieldOfView) ?? building?.anchor;
      if (!point) return;

      const score = poiScore(relative.distance, point, poi.priority, previouslyVisible.has(poi.id));
      candidates.push({poi, index, relative, building, point, score});
    });

    candidates.sort((a, b) => a.score - b.score ||
      a.relative.distance - b.relative.distance ||
      String(a.poi.id).localeCompare(String(b.poi.id)));

    const accepted = [];
    const occupied = [];
    const displayDistances = Boolean(showDistance());

    for (const candidate of candidates) {
      if (accepted.length >= MAX_VISIBLE_POIS) break;
      const {button, distance} = labels[candidate.index];

      // Distance participates in sizing and overlap avoidance.
      distance.hidden = !displayDistances;
      if (displayDistances) distance.textContent = formatPoiDistance(candidate.relative.distance);
      button.hidden = false;

      const labelWidth = button.offsetWidth;
      const labelHeight = button.offsetHeight;
      if (!labelWidth || !labelHeight ||
        labelWidth + 2 * SCREEN_MARGIN_PX > width ||
        labelHeight + 2 * SCREEN_MARGIN_PX > height) {
        button.hidden = true;
        continue;
      }
      const anchorX = screenX(candidate.point);
      const anchorY = screenY(candidate.point);
      const x = clamp(anchorX, labelWidth / 2 + SCREEN_MARGIN_PX,
        width - labelWidth / 2 - SCREEN_MARGIN_PX);
      const left = x - labelWidth / 2;
      const right = x + labelWidth / 2;
      const above = anchorY - LABEL_OFFSET_PX - labelHeight;
      const below = anchorY + LABEL_OFFSET_PX;
      const previousSide = previouslyVisible.get(candidate.poi.id);
      const placements = candidate.building
        ? [{y: clamp(anchorY, SCREEN_MARGIN_PX, height - labelHeight - SCREEN_MARGIN_PX)}]
        : [{y: above, side: 'above'}, {y: below, side: 'below'}];
      if (previousSide === 'below' && !candidate.building) placements.reverse();

      let placed = false;
      for (const {y, side} of placements) {
        if (y < SCREEN_MARGIN_PX || y + labelHeight > height - SCREEN_MARGIN_PX) continue;
        const rect = {left, right, top: y, bottom: y + labelHeight};
        const footprint = candidate.building ? rect : {
          left: Math.min(left, anchorX - POINT_RADIUS_PX),
          right: Math.max(right, anchorX + POINT_RADIUS_PX),
          top: Math.min(y, anchorY - POINT_RADIUS_PX),
          bottom: Math.max(y + labelHeight, anchorY + POINT_RADIUS_PX),
        };
        if (occupied.some(other => overlaps(footprint, other))) continue;

        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
        occupied.push(footprint);
        accepted.push({...candidate, side, anchorX, anchorY, rect});
        placed = true;
        break;
      }
      if (!placed) button.hidden = true;
    }

    const visibleBuildings = accepted.map(candidate => candidate.building).filter(Boolean);
    drawShadedBuildings(ctx, visibleBuildings, screenX, screenY);
    for (const candidate of accepted) {
      if (!candidate.building) drawPointMarker(ctx, candidate);
    }
    previouslyVisible = new Map(accepted.map(candidate => [candidate.poi.id, candidate.side]));
  };
}
