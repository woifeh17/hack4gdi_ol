import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {drawShadedBuildings} from '../src/ar/shadedBuildings.js';
import {distanceAndBearing, manualCameraPose} from '../src/ar/geometry.js';
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
  drawShadedBuildings(ctx, [{poi: arena, relative, up: 0}], manualCameraPose(0, 0),
    [65, 55], point => point.x, point => point.y, () => model);
  assert.ok(fills > 0);

  for (const poi of catalogue.filter(poi => poi.building?.lod2)) {
    const {vertices, faces} = await provider.load(poi);
    assert.ok(vertices.flat().every(Number.isFinite));
    assert.ok(faces.every(face => face.rings[0].every(index => vertices[index])));
  }
});
