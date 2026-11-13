import {distanceAndBearing, projectPoi} from './geometry.js';
import {drawShadedBuildings} from './shadedBuildings.js';
import {MAX_POI_DISTANCE_M as MAX_DISTANCE_M, MAX_VISIBLE_POIS} from './visibilityConfig.js';
import {formatPoiDistance} from './formatDistance.js';

const RAD = Math.PI / 180;

// Preserve the current expanded AR visibility settings.
const COLLISION_GAP_PX = 10;
const SCREEN_MARGIN_PX = 6;
const PRIORITY_BONUS_M = 45;
const STABILITY_BONUS_M = 60;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function overlaps(a, b) {
  const gap = COLLISION_GAP_PX;
  return a.left < b.right + gap && a.right + gap > b.left &&
    a.top < b.bottom + gap && a.bottom + gap > b.top;
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
  let previouslyVisible = new Set();

  return ({position, camera}, fieldOfView) => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const scale = Math.min(window.devicePixelRatio || 1, 2);
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

    ctx.strokeStyle = '#b2f5e5';
    ctx.lineWidth = 1.6;

    const candidates = [];
    entries.forEach((poi, index) => {
      const relative = offsets[index];
      if (!relative || relative.bearing == null || relative.distance > MAX_DISTANCE_M) return;

      const up = Number.isFinite(poi.altitude) && Number.isFinite(position.altitude)
        ? poi.altitude - position.altitude : 0;
      const elevation = Math.atan2(up, relative.distance) / RAD;
      const point = projectPoi(relative.bearing, elevation, camera, ...fieldOfView);
      if (!point) return;

      const priority = Number.isFinite(poi.priority) ? poi.priority : 2;
      const score = relative.distance -
        (priority === 1 ? PRIORITY_BONUS_M : 0) -
        (previouslyVisible.has(poi.id) ? STABILITY_BONUS_M : 0);
      candidates.push({poi, index, relative, up, point, score});
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
      const x = clamp(screenX(candidate.point),
        labelWidth / 2 + SCREEN_MARGIN_PX, width - labelWidth / 2 - SCREEN_MARGIN_PX);
      const y = clamp(screenY(candidate.point),
        SCREEN_MARGIN_PX, height - labelHeight - SCREEN_MARGIN_PX);
      const rect = {
        left: x - labelWidth / 2, right: x + labelWidth / 2,
        top: y, bottom: y + labelHeight
      };
      if (occupied.some(other => overlaps(rect, other))) {
        button.hidden = true;
        continue;
      }
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
      occupied.push(rect);
      accepted.push(candidate);
    }

    // All accepted POIs share the same label/model visibility decision.
    // Faces are sorted and shaded together, rather than in arbitrary POI order.
    drawShadedBuildings(ctx, accepted, camera, fieldOfView, screenX, screenY, getModel);
    previouslyVisible = new Set(accepted.map(candidate => candidate.poi.id));
  };
}
