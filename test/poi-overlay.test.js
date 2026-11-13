import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOverlay} from '../src/ar/overlay.js';
import {manualCameraPose} from '../src/ar/geometry.js';
import {poiScore} from '../src/ar/poiScore.js';

test('distance wins over accumulated bonuses, with a small preference for stable labels', () => {
  const center = {x: 0.5, y: 0.5};
  const edge = {x: 1, y: 0.5};
  assert.ok(poiScore(50, edge, 2, false) < poiScore(90, center, 1, true));
  assert.ok(poiScore(110, center, 2, true) < poiScore(105, center, 2, false));
  assert.ok(poiScore(120, center, 2, false) < poiScore(120, edge, 2, false));
  assert.ok(poiScore(120, center, 1, false) < poiScore(120, center, 2, false));
});

test('draws one anchor and leader for a point POI, and keeps a competing label out', t => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({style: {}, offsetWidth: 100, offsetHeight: 26, append() {}, addEventListener() {}}),
  };
  t.after(() => { globalThis.document = originalDocument; });

  const points = [];
  const lines = [];
  const ctx = {
    setTransform() {}, clearRect() { points.length = 0; lines.length = 0; },
    beginPath() {}, moveTo() {}, lineTo(x, y) { lines.push([x, y]); },
    arc(x, y) { points.push([x, y]); }, fill() {}, stroke() {},
  };
  const labels = [];
  const markers = {replaceChildren() {}, append(label) { labels.push(label); }};
  const canvas = {clientWidth: 360, clientHeight: 640, getContext: () => ctx};
  const video = {classList: {contains: () => false}};
  const entries = [
    {id: 'near', name: 'Near', lat: 50.0005, lon: 8},
    {id: 'far', name: 'Far', lat: 50.001, lon: 8, priority: 1},
  ];
  const wireframe = {vertices: [[0, 0, 0], [0, 1, 1]], edges: [[0, 1]]};
  const render = createOverlay(canvas, markers, entries, () => {}, video, () => wireframe);
  const position = {lat: 50, lon: 8};
  const fov = [65, 55];

  render({position, camera: manualCameraPose(0, 0)}, fov);
  assert.deepEqual(labels.map(label => label.hidden), [false, true]);
  assert.deepEqual(points, [[180, 320]]);
  assert.deepEqual(lines, [[180, 304]]);
  assert.equal(labels[0].style.top, '278px');

  render({position, camera: manualCameraPose(0, -27)}, fov);
  assert.ok(parseFloat(labels[0].style.top) > points[0][1]);
});
