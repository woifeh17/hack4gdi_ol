import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {drawShadedBuildings, projectBuilding} from '../src/ar/shadedBuildings.js';
import {distanceAndBearing, manualCameraPose, projectPoi} from '../src/ar/geometry.js';
import {createOverlay} from '../src/ar/overlay.js';
import {mainz} from '../src/device/position.js';
import {pois} from '../src/data/mainzTestPois.js';
import {applyLod2Manifest, createLod2BuildingProvider} from '../src/data/providers/lod2Buildings.js';

const assets = new URL('../assets/buildings/lod2/', import.meta.url);

test('published LoD2 tiles resolve every POI link and shade the MEWA Arena', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', assets)));
  const catalogue = pois.map(poi => ({...poi}));
  assert.equal(applyLod2Manifest(catalogue, manifest), Object.keys(manifest.pois).length);
  const requests = [];
  const provider = createLod2BuildingProvider({load: () => null}, {
    fetchFn: async url => {
      requests.push(url);
      return {ok: true, json: async () => JSON.parse(await readFile(new URL(url.split('/').at(-1), assets)))};
    },
  });
  const arena = catalogue.find(poi => poi.id === 'arena');
  const [model] = await Promise.all([provider.load(arena), provider.load(arena)]);
  assert.equal(requests.length, new Set(requests).size);
  assert.equal(model.lod, 2);
  assert.ok(model.faces.some(face => face.surface === 'roof'));
  let fills = 0;
  const ctx = {beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() { fills++; }};
  const relative = distanceAndBearing(arena.lat - 0.002, arena.lon, arena.lat, arena.lon);
  const pose = manualCameraPose(0, 0);
  const fov = [65, 55];
  const building = projectBuilding(model, {relative, up: 0}, pose, fov);
  drawShadedBuildings(ctx, [building], point => point.x, point => point.y);
  assert.ok(fills > 0);

  for (const poi of catalogue.filter(poi => poi.building?.lod2)) {
    const {vertices, faces} = await provider.load(poi);
    assert.ok(vertices.flat().every(Number.isFinite));
    assert.ok(faces.every(face => face.rings[0].every(index => vertices[index])));
  }
});


test('shows and labels the real Mainz campus when its POI is outside the camera image', async t => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', assets)));
  const campus = {...pois.find(poi => poi.id === 'hochschule')};
  assert.equal(applyLod2Manifest([campus], manifest), 1);
  const provider = createLod2BuildingProvider({load: () => null}, {
    fetchFn: async url => ({
      ok: true,
      json: async () => JSON.parse(await readFile(new URL(url.split('/').at(-1), assets))),
    }),
  });
  const model = await provider.load(campus);

  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({style: {}, offsetWidth: 140, offsetHeight: 26, append() {}, addEventListener() {}}),
  };
  t.after(() => { globalThis.document = originalDocument; });

  let label;
  const markers = {replaceChildren() {}, append(button) { label = button; }};
  let fills = 0;
  const ctx = {
    stroke() {}, arc() {}, setTransform() {}, clearRect() { fills = 0; },
    beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() { fills++; },
  };
  const canvas = {clientWidth: 360, clientHeight: 640, getContext: () => ctx};
  const video = {classList: {contains: () => false}};
  const render = createOverlay(canvas, markers, [campus], () => {}, video, () => model);
  const fov = [65, 55];
  const camera = manualCameraPose(0, 0);
  const {bearing} = distanceAndBearing(mainz.lat, mainz.lon, campus.lat, campus.lon);
  assert.equal(projectPoi(bearing, 0, camera, ...fov), null);
  render({position: mainz, camera}, fov);
  assert.equal(label.hidden, false);
  assert.ok(fills > 0);
  render({position: mainz, camera: manualCameraPose(0, -90)}, fov);
  assert.equal(label.hidden, true);
  assert.equal(fills, 0);
});
