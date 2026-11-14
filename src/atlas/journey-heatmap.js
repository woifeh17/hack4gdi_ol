const CELL_SIZE = 9;
const RADIUS = 19;

function createCanvas(width, height) {
  return Object.assign(document.createElement('canvas'), {width, height});
}

// Sample only the visible portion of an edge, with a margin for the heat radius.
function sampleEdge(a, b, width, height, add) {
  let start = 0;
  let end = 1;
  for (const [from, to, limit] of [[a.x, b.x, width], [a.y, b.y, height]]) {
    const delta = to - from;
    if (!delta) {
      if (from < -RADIUS || from > limit + RADIUS) return;
      continue;
    }
    const first = (-RADIUS - from) / delta;
    const last = (limit + RADIUS - from) / delta;
    start = Math.max(start, Math.min(first, last));
    end = Math.min(end, Math.max(first, last));
  }
  if (start > end) return;
  const steps = Math.max(1, Math.ceil(a.distanceTo(b) * (end - start) / (CELL_SIZE / 2)));
  for (let step = 0; step <= steps; step++) {
    const t = start + (end - start) * step / steps;
    add(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }
}

export function createJourneyHeatmap(L, map) {
  const canvas = createCanvas(0, 0);
  canvas.className = 'atlas-map__heat';
  canvas.setAttribute('aria-hidden', 'true');
  const pane = map.createPane('journeyHeat');
  pane.style.zIndex = '350';
  pane.style.pointerEvents = 'none';
  pane.append(canvas);
  const context = canvas.getContext('2d', {willReadFrequently: true});

  const kernel = createCanvas(2 * RADIUS, 2 * RADIUS);
  const brush = kernel.getContext('2d');
  const radial = brush.createRadialGradient(RADIUS, RADIUS, 0, RADIUS, RADIUS, RADIUS);
  radial.addColorStop(0, 'rgba(0,0,0,.24)');
  radial.addColorStop(1, 'rgba(0,0,0,0)');
  brush.fillStyle = radial;
  brush.fillRect(0, 0, kernel.width, kernel.height);

  const palette = createCanvas(256, 1).getContext('2d');
  const gradient = palette.createLinearGradient(0, 0, 256, 0);
  gradient.addColorStop(0, '#6b63ff');
  gradient.addColorStop(.44, '#6b63ff');
  gradient.addColorStop(.72, '#f79032');
  gradient.addColorStop(1, '#e6224d');
  palette.fillStyle = gradient;
  palette.fillRect(0, 0, 256, 1);
  const colors = palette.getImageData(0, 0, 256, 1).data;

  let tracks = [];
  let frame = null;

  function draw() {
    frame = null;
    const {x: width, y: height} = map.getSize();
    if (!width || !height) return;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    canvas.width = width;
    canvas.height = height;
    if (!tracks.length) return;
    // Use a world-pixel grid so cells remain stable while the user pans.
    const origin = map.getPixelBounds().min;
    for (const segments of tracks) {
      const visited = new Set();
      const add = (x, y) => {
        if (x < -RADIUS || x > width + RADIUS || y < -RADIUS || y > height + RADIUS) return;
        const col = Math.floor((x + origin.x) / CELL_SIZE);
        const row = Math.floor((y + origin.y) / CELL_SIZE);
        const id = `${col},${row}`;
        if (visited.has(id)) return;
        visited.add(id);
        context.drawImage(kernel,
          (col + .5) * CELL_SIZE - origin.x - RADIUS,
          (row + .5) * CELL_SIZE - origin.y - RADIUS);
      };
      for (const segment of segments) {
        let previous = null;
        for (const latlng of segment) {
          const point = map.latLngToContainerPoint(latlng);
          if (previous) sampleEdge(previous, point, width, height, add);
          else add(point.x, point.y);
          previous = point;
        }
      }
    }

    const image = context.getImageData(0, 0, width, height);
    for (let i = 0; i < image.data.length; i += 4) {
      const alpha = image.data[i + 3];
      if (!alpha) continue;
      image.data[i] = colors[alpha * 4];
      image.data[i + 1] = colors[alpha * 4 + 1];
      image.data[i + 2] = colors[alpha * 4 + 2];
      image.data[i + 3] = Math.min(220, alpha * 1.7);
    }
    context.putImageData(image, 0, 0);
  }

  function scheduleDraw() {
    if (frame === null) frame = requestAnimationFrame(draw);
  }

  map.on('move zoomend resize', scheduleDraw);
  return {
    setTracks(next) {
      tracks = next.filter(segments => segments.length);
      scheduleDraw();
    },
  };
}
