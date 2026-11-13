import {distanceAndBearing, projectPoi} from './geometry.js';
import {projectEnuEdge} from './buildingGeometry.js';

const radians = Math.PI / 180;

export function createOverlay(canvas, markers, entries, onScan, video, getModel = poi => poi.model) {
  const ctx = canvas.getContext('2d');
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

  return ({position, camera}, fieldOfView) => {
    const {clientWidth: width, clientHeight: height} = canvas;
    const scale = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (position !== lastPosition) {
      offsets = entries.map(poi => distanceAndBearing(position.lat, position.lon, poi.lat, poi.lon));
      lastPosition = position;
    }
    const videoAspect = video.classList.contains('active') && video.videoHeight
      ? video.videoWidth / video.videoHeight : width / height;
    const frameWidth = Math.min(width, height * videoAspect);
    const frameHeight = Math.min(height, width / videoAspect);
    const left = (width - frameWidth) / 2;
    const top = (height - frameHeight) / 2;
    const screenX = point => left + point.x * frameWidth;
    const screenY = point => top + point.y * frameHeight;
    ctx.strokeStyle = '#b2f5e5';
    ctx.lineWidth = 1.6;
    entries.forEach((poi, index) => {
      const relative = offsets[index];
      const label = labels[index];
      const up = Number.isFinite(poi.altitude) && Number.isFinite(position.altitude)
        ? poi.altitude - position.altitude : 0;
      const elevation = Math.atan2(up, relative?.distance) / radians;
      const point = camera && relative?.bearing != null
        ? projectPoi(relative.bearing, elevation, camera, ...fieldOfView) : null;
      label.hidden = !point;
      if (point) {
        label.style.left = `${screenX(point)}px`;
        label.style.top = `${screenY(point)}px`;
      }
      const model = getModel(poi);
      if (!model || !camera || !relative) return;
      // Das Gebäude darf auch sichtbar sein, wenn sein POI-Mittelpunkt außerhalb liegt.
      const east = Math.sin((relative.bearing ?? 0) * radians) * relative.distance;
      const north = Math.cos((relative.bearing ?? 0) * radians) * relative.distance;
      const vertices = model.vertices.map(([x, y, z]) => [east + x, north + y, up + z]);
      ctx.beginPath();
      for (const [start, end] of model.edges) {
        const segment = projectEnuEdge(vertices[start], vertices[end], camera, ...fieldOfView);
        if (!segment) continue;
        ctx.moveTo(screenX(segment[0]), screenY(segment[0]));
        ctx.lineTo(screenX(segment[1]), screenY(segment[1]));
      }
      ctx.stroke();
    });
  };
}