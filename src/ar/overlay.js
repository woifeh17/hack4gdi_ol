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

    // Kamerabild selbst randabdeckend („cover“) in den Canvas zeichnen.
    // Manche Browser – insbesondere Firefox auf iOS – wenden object-fit: cover
    // auf dem <video>-Element nicht zuverlässig an und zeigen das Bild klein
    // und eingepasst statt vollflächig. Der Canvas liegt über dem Video-Element,
    // das gezeichnete Bild füllt die ganze Fläche und deckt alles darunter ab.
    if (video.classList.contains('active') && video.videoWidth && video.videoHeight) {
      const videoAspect = video.videoWidth / video.videoHeight;
      const canvasAspect = width / height;
      // Seiten des Quellvideos beschneiden, damit kein Verzerren entsteht.
      let sx = 1, sy = 1;
      if (canvasAspect > videoAspect) sy = videoAspect / canvasAspect;
      else sx = canvasAspect / videoAspect;
      ctx.drawImage(
        video,
        (1 - sx) / 2 * video.videoWidth, (1 - sy) / 2 * video.videoHeight,
        sx * video.videoWidth, sy * video.videoHeight,
        0, 0, width, height
      );
    }
    // Das sichtbare Kamerabild füllt den gesamten Canvas randabdeckend;
    // POI-Projektion und Beschriftungen nutzen deshalb die volle Fläche
    // (statt wie zuvor nur einen eingepassten Letterbox-Rahmen).
    const frameWidth = width;
    const frameHeight = height;
    const frameLeft = 0;
    const frameTop = 0;
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
      const wideFov = fieldOfView.map(angle => Math.min(170, angle + 24));
      const nearby = point ?? projectPoi(relative.bearing, elevation, camera, ...wideFov);
      if (!nearby) return;
      const projected = point ?? {
        x: 0.5 + (nearby.x - 0.5) * Math.tan(wideFov[0] * RAD / 2) / Math.tan(fieldOfView[0] * RAD / 2),
        y: 0.5 + (nearby.y - 0.5) * Math.tan(wideFov[1] * RAD / 2) / Math.tan(fieldOfView[1] * RAD / 2),
      };


      const score = poiScore(relative.distance, projected, poi.priority, previouslyVisible.has(poi.id));
      candidates.push({poi, index, relative, building, point: projected, visible: Boolean(point), score});
    });

    candidates.sort((a, b) =>
      a.score - b.score ||
      a.relative.distance - b.relative.distance ||
      String(a.poi.id).localeCompare(String(b.poi.id)));

    const accepted = [];
    const occupied = [];
    const layout = new Map();
    const displayDistances = Boolean(showDistance());

    for (const candidate of candidates) {
      if (candidate.visible && accepted.length >= MAX_VISIBLE_POIS) continue;
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
      const slots = [0, 1, 2, 3, 4, 5];
      const previous = previouslyVisible.get(candidate.poi.id);
      if (previous != null) slots.sort((a, b) => Number(b === previous) - Number(a === previous));
      let placed = false;
      for (const slot of slots) {
        const side = slot % 2 === 0 ? 'above' : 'below';
        const row = Math.floor(slot / 2);
        const x = candidate.visible
          ? clamp(anchorX, labelWidth / 2 + SCREEN_MARGIN_PX, width - labelWidth / 2 - SCREEN_MARGIN_PX)
          : anchorX;
        const y = side === 'above'
          ? anchorY - LABEL_OFFSET_PX - labelHeight - row * (labelHeight + COLLISION_GAP_PX)
          : anchorY + LABEL_OFFSET_PX + row * (labelHeight + COLLISION_GAP_PX);
        if (candidate.visible && (y < SCREEN_MARGIN_PX || y + labelHeight > height - SCREEN_MARGIN_PX)) continue;
        const rect = {left: x - labelWidth / 2, right: x + labelWidth / 2, top: y, bottom: y + labelHeight};
        if (occupied.some(other => overlaps(rect, other))) continue;
        occupied.push(rect);
        layout.set(candidate.poi.id, slot);
        button.hidden = !candidate.visible;
        button.style.left = `${x}px`;
        button.style.top = `${y}px`;
        if (candidate.visible) accepted.push({...candidate, side, anchorX, anchorY, rect});
        placed = true;
        break;
      }
      if (!placed) button.hidden = true;
    }

    const visibleBuildings = accepted.map(candidate => candidate.building).filter(Boolean);
    drawShadedBuildings(ctx, visibleBuildings, screenX, screenY);
    for (const candidate of accepted) {
      drawPointMarker(ctx, candidate);
    }
    previouslyVisible = layout;
  };
}
