
import {distanceAndBearing, projectPoi} from './geometry.js';
import {projectEnuEdge} from './buildingGeometry.js';

const RAD = Math.PI / 180;

// Unified POI visibility configuration
const MAX_DISTANCE_M = 500;
const MAX_VISIBLE_POIS = 6;
const COLLISION_GAP_PX = 10;
const SCREEN_MARGIN_PX = 6;

// Small bonuses for priority and display stability.
// Distance remains the main selection criterion.
const PRIORITY_BONUS_M = 15;
const STABILITY_BONUS_M = 30;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function overlaps(a, b) {
  const gap = COLLISION_GAP_PX;

  return (
    a.left < b.right + gap &&
    a.right + gap > b.left &&
    a.top < b.bottom + gap &&
    a.bottom + gap > b.top
  );
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

  let lastPosition = null;
  let offsets = [];
  let previouslyVisible = new Set();

  function renderModel(
    candidate,
    camera,
    fieldOfView,
    screenX,
    screenY
  ) {
    const {poi, relative, up} = candidate;
    const model = getModel(poi);

    if (!model?.vertices?.length || !model?.edges?.length) {
      return;
    }

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

    let drawnEdges = 0;

    for (const [start, end] of model.edges) {
      const a = vertices[start];
      const b = vertices[end];

      if (!a || !b) continue;

      const segment = projectEnuEdge(
        a,
        b,
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

      drawnEdges++;
    }

    if (drawnEdges > 0) {
      ctx.stroke();
    }
  }

  return ({position, camera}, fieldOfView) => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (!width || !height) return;

    const scale = Math.min(
      window.devicePixelRatio || 1,
      2
    );

    if (
      canvas.width !== Math.round(width * scale) ||
      canvas.height !== Math.round(height * scale)
    ) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
    }

    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Hide everything before calculating visibility.
    for (const label of labels) {
      label.hidden = true;
    }

    if (!position || !camera) {
      previouslyVisible.clear();
      return;
    }

    // Calculate geodetic offsets only after position changes.
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

    const videoAspect =
      video.classList.contains('active') && video.videoHeight
        ? video.videoWidth / video.videoHeight
        : width / height;

    const frameWidth = Math.min(
      width,
      height * videoAspect
    );

    const frameHeight = Math.min(
      height,
      width / videoAspect
    );

    const frameLeft = (width - frameWidth) / 2;
    const frameTop = (height - frameHeight) / 2;

    const screenX = point =>
      frameLeft + point.x * frameWidth;

    const screenY = point =>
      frameTop + point.y * frameHeight;

    ctx.strokeStyle = '#b2f5e5';
    ctx.lineWidth = 1.6;

    // STEP 1: Collect candidates in the field of view.
    const candidates = [];

    entries.forEach((poi, index) => {
      const relative = offsets[index];

      if (
        !relative ||
        relative.bearing == null ||
        relative.distance > MAX_DISTANCE_M
      ) {
        return;
      }

      const up =
        Number.isFinite(poi.altitude) &&
        Number.isFinite(position.altitude)
          ? poi.altitude - position.altitude
          : 0;

      const elevation =
        Math.atan2(up, relative.distance) / RAD;

      const point = projectPoi(
        relative.bearing,
        elevation,
        camera,
        ...fieldOfView
      );

      if (!point) return;

      // Primary criterion: physical distance.
      // Priority and persistence only slightly adjust it.
      const priority = Number.isFinite(poi.priority)
        ? poi.priority
        : 2;

      const priorityBonus =
        priority === 1 ? PRIORITY_BONUS_M : 0;

      const stabilityBonus =
        previouslyVisible.has(poi.id)
          ? STABILITY_BONUS_M
          : 0;

      const score =
        relative.distance -
        priorityBonus -
        stabilityBonus;

      candidates.push({
        poi,
        index,
        relative,
        up,
        point,
        score
      });
    });

    // STEP 2: Sort candidates consistently.
    candidates.sort((a, b) =>
      a.score - b.score ||
      a.relative.distance - b.relative.distance ||
      String(a.poi.id).localeCompare(String(b.poi.id))
    );

    // STEP 3: Select non-overlapping labels.
    const accepted = [];
    const occupied = [];

    for (const candidate of candidates) {
      if (accepted.length >= MAX_VISIBLE_POIS) break;

      const label = labels[candidate.index];

      // Temporarily reveal to measure its dimensions.
      label.hidden = false;

      const labelWidth = label.offsetWidth;
      const labelHeight = label.offsetHeight;

      if (
        !labelWidth ||
        !labelHeight ||
        labelWidth + 2 * SCREEN_MARGIN_PX > width ||
        labelHeight + 2 * SCREEN_MARGIN_PX > height
      ) {
        label.hidden = true;
        continue;
      }

      const x = clamp(
        screenX(candidate.point),
        labelWidth / 2 + SCREEN_MARGIN_PX,
        width - labelWidth / 2 - SCREEN_MARGIN_PX
      );

      const y = clamp(
        screenY(candidate.point),
        SCREEN_MARGIN_PX,
        height - labelHeight - SCREEN_MARGIN_PX
      );

      const bounds = {
        left: x - labelWidth / 2,
        right: x + labelWidth / 2,
        top: y,
        bottom: y + labelHeight
      };

      if (occupied.some(rect => overlaps(bounds, rect))) {
        label.hidden = true;
        continue;
      }

      label.style.left = `${x}px`;
      label.style.top = `${y}px`;

      occupied.push(bounds);
      accepted.push(candidate);
    }

    // STEP 4: Render models ONLY for accepted POIs.
    // A hidden label can never leave a visible model behind.
    for (const candidate of accepted) {
      renderModel(
        candidate,
        camera,
        fieldOfView,
        screenX,
        screenY
      );
    }

    // STEP 5: Remember selected POIs for next frame.
    previouslyVisible = new Set(
      accepted.map(candidate => candidate.poi.id)
    );
  };
}
