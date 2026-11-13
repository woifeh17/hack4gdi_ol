import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseBuildingFeature, buildingHeights, buildingToModel, projectEnuEdge} from '../src/ar/buildingGeometry.js';
import {manualCameraPose} from '../src/ar/geometry.js';
import {createOSMBuildingsProvider, overpassQuery, tilesForPoi} from '../src/data/providers/osmBuildings.js';
import {createBuildingStream, selectRelevantBuildings} from '../src/poi/visibilityManager.js';

const poi = {id: 'test', name: 'Demohaus', lat: 49.988, lon: 8.227,
  building: {enabled: true, searchRadiusM: 80}};
const outline = [
  [8.2269, 49.98795], [8.2271, 49.98795], [8.2271, 49.98805],
  [8.2269, 49.98805], [8.2269, 49.98795],
];
const other = [
  [8.2310, 49.98995], [8.2311, 49.98995], [8.2311, 49.99005],
  [8.2310, 49.99005], [8.2310, 49.98995],
];
const feature = (id, ring, tags = {}) => ({type:'Feature', id, properties:tags,
  geometry:{type:'Polygon', coordinates:[ring]}});

const fakeResponse = data => ({ok:true, json:async () => data});

test('findet das Gebäude am POI statt eines anderen Gebäudes in der Kachel', () => {
  const chosen = chooseBuildingFeature([
    feature('away', other, {height:100}), feature('near', outline, {height:10}),
  ], poi);
  assert.equal(chosen.id, 'near');
  assert.equal(chooseBuildingFeature([feature('away', other)], poi), null);
});

test('berechnet LOD1 in ENU-Metern inklusive OSM-Höhenattributen', () => {
  const f = chooseBuildingFeature([feature('1', outline, {'building:levels':'3', 'min_height':'2'})], poi);
  const model = buildingToModel(f, poi);
  assert.equal(model.lod, 1);
  assert.equal(model.vertices.length, 8);
  assert.equal(model.edges.length, 12);
  assert.equal(buildingHeights(f.tags).height, 9);
  assert.equal(model.vertices[0][2], 2);
  assert.equal(model.vertices[1][2], 9);
  assert.ok(Math.abs(model.vertices[0][0]) < 10);
});

test('generiert einen Satteldachfirst nur für passende quadrilaterale Grundrisse', () => {
  const f = chooseBuildingFeature([feature('1', outline, {height:'12', 'roof:shape':'gabled', 'roof:height':'3'})], poi);
  const model = buildingToModel(f, poi);
  assert.equal(model.lod, 2);
  assert.equal(model.vertices.length, 10);
  assert.ok(model.vertices.some(p => p[2] === 12));
});

test('Kamerafrustum schneidet teilweise sichtbare Gebäudekanten nicht komplett ab', () => {
  const pose = manualCameraPose(0, 0);
  const edge = projectEnuEdge([0, 10, 0], [50, 10, 0], pose, 65, 55);
  assert.ok(edge);
  assert.ok(Math.abs(edge[0].x - 0.5) < 0.001);
  assert.ok(Math.abs(edge[1].x - 1.0) < 0.001);
  assert.equal(projectEnuEdge([0, -10, 0], [50, -10, 0], pose, 65, 55), null);
});

test('lädt POIs anhand Entfernung und Richtung; Nord-Azimut 0 ist gültig', () => {
  const north = {...poi, id:'north', lat:49.991};
  const south = {...poi, id:'south', lat:49.985};
  const found = selectRelevantBuildings([north, south], {lat:49.988, lon:8.227}, {heading:0});
  assert.deepEqual(found.map(p => p.id), ['north']);
});

test('lädt nahe Gebäudekomplexe auch entgegen der Blickrichtung vor', () => {
  const campus = {...poi, lat: poi.lat - 0.001};
  assert.deepEqual(selectRelevantBuildings([campus], poi, {heading: 0}), [campus]);
});

test('Kachelberechnung begrenzt das Suchgebiet', () => {
  const tiles = tilesForPoi(poi, 80);
  assert.ok(tiles.length >= 1 && tiles.length <= 4);
  const query = overpassQuery(poi, 80);
  assert.ok(query.includes('way["building"]'));
  assert.ok(query.includes('out geom'));
});

test('OSM Buildings-Provider streamt Tiles und vermeidet doppelte Downloads', async () => {
  let requests = 0;
  const provider = createOSMBuildingsProvider({
    tileTemplate:'https://tiles.example/{z}/{x}/{y}',
    fetchFn: async () => { requests++; return fakeResponse({type:'FeatureCollection', features:[feature('42', outline, {height:18})]}); },
  });
  const [a, b] = await Promise.all([provider.load(poi), provider.load({...poi, id:'other'})]);
  assert.equal(a.osmId, '42');
  assert.equal(b.provider, 'OSM Buildings');
  assert.equal(requests, tilesForPoi(poi, 80).length);
});

test('greift bei nicht verfügbaren OSM Buildings-Tiles gezielt auf Overpass zurück', async () => {
  let tileCalls = 0, overpassCalls = 0;
  const provider = createOSMBuildingsProvider({
    tileTemplate: 'https://example.org/{z}/{x}/{y}.json',
    fetchFn: async (url, options) => {
      if (options?.method === 'POST') {
        overpassCalls++;
        return fakeResponse({elements:[{type:'way',id:99,tags:{height:'14'},
          geometry:outline.map(([lon,lat]) => ({lon,lat}))}]});
      }
      tileCalls++;
      return {ok:false,status:403};
    },
  });
  const model = await provider.load(poi);
  assert.equal(model.osmId, '99');
  assert.equal(model.provider, 'OpenStreetMap (Overpass-Fallback)');
  assert.ok(tileCalls >= 1);
  assert.equal(overpassCalls, 1);
});

test('Streaming-Manager fragt denselben POI nicht in jedem Frame erneut ab', async () => {
  let calls = 0;
  const provider = {load: async () => { calls++; return {vertices:[],edges:[]}; }};
  let clock = 10000;
  const stream = createBuildingStream([poi], provider, {now:() => clock, updateEveryMs:0});
  const frame = {position: {...poi}, camera:null};
  stream.update(frame);
  await new Promise(resolve => setImmediate(resolve));
  clock++;
  stream.update(frame);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(stream.getStatus(poi), 'loaded');
});
