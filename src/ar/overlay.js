
import {distanceAndBearing, projectPoi} from './geometry.js';
import {projectEnuEdge} from './buildingGeometry.js';

const RAD = Math.PI / 180;

// AR label settings
const MAX_LABEL_DISTANCE_M = 300;
const MAX_VISIBLE_LABELS = 6;
const LABEL_GAP_PX = 10;
const SCREEN_MARGIN_PX = 6;

// Small preference for labels already visible.
// Prevents rapid switching while travelling.
const PERSISTENCE_BONUS_M = 25;

function overlaps(a, b, gap = LABEL_GAP_PX) {
  return (
    a.left < b.right + gap &&
    a.right + gap > b.left &&
    a.top < b.bottom + gap &&
    a.bottom + gap > b.top
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createOverlay(
  canvas,
  markers,
  entries,
  onScan,
  video,
  getModel = poi => poi.model
) {
  const ctx = canvas.getContext('2d');

  // Remove markers from any previous overlay instance.
  markers.replaceChildren();

  const labels = entries.map(poi => {
    const button = document.createElement('button');

    button.className = 'marker';
    button.textContent = poi.name;
    button.hidden = true;

    button.addEventListener('click', () => onScan(poi));

    markers.append(button);
    return button;
  });

  let lastPosition;
  let offsets;
  let previouslyVisible = new Set();

  return ({position, camera}, fieldOfView) => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (!width || !height || !position) return;

    const scale = Math.min(window.devicePixelRatio || 1, 2);

    if (
      canvas.width !== Math.round(width * scale) ||
      canvas.height !== Math.round(height * scale)
    ) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
    }

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (position !== lastPosition) {
      offsets = entries.map(poi =>
        distanceAndBearing(
          position.lat,
          position.lon,
          poi.lat,
          poi.lon
        )
      );

      lastPosition = position;
    }

    // Respect the actual camera video dimensions.
    const videoAspect =
      video.classList.contains('active') && video.videoHeight
        ? video.videoWidth / video.videoHeight
        : width / height;

    const frameWidth = Math.min(width, height * videoAspect);
    const frameHeight = Math.min(height, width / videoAspect);

    const left = (width - frameWidth) / 2;
    const top = (height - frameHeight) / 2;

    const screenX = point => left + point.x * frameWidth;
    const screenY = point => top + point.y * frameHeight;

    ctx.strokeStyle = '#b2f5e5';
    ctx.lineWidth = 1.6;

    // Start with every label hidden.
    labels.forEach(label => {
      label.hidden = true;
    });

    const candidates = [];

    entries.forEach((poi, index) => {
      const relative = offsets[index];

      if (!relative || relative.bearing == null) return;

      const up =
        Number.isFinite(poi.altitude) &&
        Number.isFinite(position.altitude)
          ? poi.altitude - position.altitude
          : 0;

      const elevation =
        Math.atan2(up, relative.distance) / RAD;

      const point = camera
        ? projectPoi(
            relative.bearing,
            elevation,
            camera,
            ...fieldOfView
          )
        : null;

      // Only consider POI labels within the configured radius.
      if (
        point &&
        relative.distance <= MAX_LABEL_DISTANCE_M
      ) {
        candidates.push({
          poi,
          index,
          point,
          distance: relative.distance,
          priority: poi.priority ?? 2
        });
      }

      // Render building models independently of label visibility.
      const model = getModel(poi);

      if (!model || !camera) return;

      const east =
        Math.sin(relative.bearing * RAD) * relative.distance;

      const north =
        Math.cos(relative.bearing * RAD) * relative.distance;

      const vertices = model.vertices.map(([x, y, z]) => [
        east + x,
        north + y,
        up + z
      ]);

      ctx.beginPath();

      for (const [start, end] of model.edges) {
        const segment = projectEnuEdge(
          vertices[start],
          vertices[end],
          camera,
          ...fieldOfView
        );

        if (!segment) continue;

        ctx.moveTo(
          screenX(segment[0]),
          screenY(segment[0])
        );

        ctx.lineTo(
          screenX(segment[1]),
          screenY(segment[1])
        );
      }

      ctx.stroke();
    });

    // Prefer important POIs, then nearer ones.
    // Already-visible labels receive a small stability bonus.
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      const distanceA = a.distance -
        (previouslyVisible.has(a.poi.id)
          ? PERSISTENCE_BONUS_M
          : 0);

      const distanceB = b.distance -
        (previouslyVisible.has(b.poi.id)
          ? PERSISTENCE_BONUS_M
          : 0);

      return distanceA - distanceB;
    });

    const occupied = [];
    const nowVisible = new Set();

    for (const candidate of candidates) {
      if (nowVisible.size >= MAX_VISIBLE_LABELS) break;

      const label = labels[candidate.index];

      // Make visible temporarily to measure its actual size.
      label.hidden = false;

      const labelWidth = label.offsetWidth;
      const labelHeight = label.offsetHeight;

      const originalX = screenX(candidate.point);
      const originalY = screenY(candidate.point);

      // Keep labels inside the viewport.
      const x = width >= labelWidth + 2 * SCREEN_MARGIN_PX
        ? clamp(
            originalX,
            labelWidth / 2 + SCREEN_MARGIN_PX,
            width - labelWidth / 2 - SCREEN_MARGIN_PX
          )
        : width / 2;

      const y = height >= labelHeight + 2 * SCREEN_MARGIN_PX
        ? clamp(
            originalY,
            SCREEN_MARGIN_PX,
            height - labelHeight - SCREEN_MARGIN_PX
          )
        : Math.max(0, (height - labelHeight) / 2);

      const rect = {
        left: x - labelWidth / 2,
        right: x + labelWidth / 2,
        top: y,
        bottom: y + labelHeight
      };

      // Suppress labels that overlap an accepted label.
      if (occupied.some(other => overlaps(rect, other))) {
        label.hidden = true;
        continue;
      }

      label.style.left = `${x}px`;
      label.style.top = `${y}px`;

      occupied.push(rect);
      nowVisible.add(candidate.poi.id);
    }

    previouslyVisible = nowVisible;
  };
}
