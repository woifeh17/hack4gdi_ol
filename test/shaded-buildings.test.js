import {test} from 'node:test';
import assert from 'node:assert/strict';
import {meshFromBuildingFeature} from '../src/ar/meshGeometry.js';
import {clipProjectedPolygon, drawShadedBuildings, projectBuilding} from '../src/ar/shadedBuildings.js';
import {manualCameraPose} from '../src/ar/geometry.js';
import {createLocalBuildingProvider} from '../src/data/providers/localBuildings.js';
import {applyBuildingManifest} from '../src/data/buildingManifest.js';

const poi = {id:'test',name:'Building', lat:49.988,lon:8.227, priority:1};
const ring = [[8.22695,49.98795],[8.22705,49.98795],
  [8.22705,49.98805],[8.22695,49.98805],[8.22695,49.98795]];
const feature = (tags={}) => ({
  type:'Feature',id:'way/42',properties:tags,
  geometry:{type:'Polygon',coordinates:[ring]},
});
const selected = tags => ({id:'way/42',tags,polygons:[[ring.slice(0,-1)]]});

test('creates real shaded walls and a roof from an OSM outline (LOD1)', () => {
  const model = meshFromBuildingFeature(selected({'building':'yes',height:'16'}),poi);
  assert.equal(model.lod,1);
  assert.equal(model.vertices.length,8);
  assert.equal(model.faces.filter(f=>f.surface==='wall').length,4);
  assert.equal(model.faces.filter(f=>f.surface==='roof').length,1);
  assert.equal(model.heightSource,'OSM height');
  assert.equal(model.osmId,'way/42');
});

test('creates sloped roof planes and gable ends when OSM specifies gabled roof', () => {
  const model = meshFromBuildingFeature(selected({
    building:'church',height:'15','roof:shape':'gabled','roof:height':'4'
  }),poi);
  assert.equal(model.lod,2);
  assert.equal(model.vertices.length,10);
  assert.equal(model.faces.filter(f=>f.surface==='roof').length,2);
  assert.equal(model.faces.filter(f=>f.surface==='wall').length,6);
  assert.ok(model.vertices.some(p=>p[2]===15));
});

test('preserves holes (courtyards) as an even-odd roof polygon', () => {
  const outer = ring.slice(0,-1);
  const hole = [[8.22698,49.98798],[8.22702,49.98798],
    [8.22702,49.98802],[8.22698,49.98802]];
  const model = meshFromBuildingFeature({id:'way/42',tags:{building:'yes'},polygons:[[outer,hole]]},poi);
  assert.ok(model.faces.some(f=>f.surface==='roof'&&f.rings.length===2));
});

test('camera frustum clips partially visible roof/wall polygons', () => {
  const camera = manualCameraPose(0,0);
  const clipped = clipProjectedPolygon([[0,10,-1],[20,10,-1],[0,10,3]],camera,65,55);
  assert.ok(clipped.length>=3);
  assert.ok(clipped.every(p=>p.x>=-1e-9&&p.x<=1+1e-9&&p.y>=-1e-9&&p.y<=1+1e-9));
  assert.deepEqual(clipProjectedPolygon([[0,-10,0],[5,-10,0],[0,-10,4]],camera,65,55),[]);
});

test('draws projected shaded surfaces for a real building', () => {
  const model=meshFromBuildingFeature(selected({building:'yes',height:'10'}),poi);
  const calls=[];
  const ctx={beginPath:()=>calls.push('begin'),moveTo:()=>{},lineTo:()=>{},
    closePath:()=>{},fill:()=>calls.push('fill'),stroke:()=>calls.push('stroke')};
  const pose = manualCameraPose(0, 0);
  const fov = [65, 55];
  const projected = projectBuilding(model, {relative: {bearing: 0, distance: 30}, up: 0}, pose, fov);
  drawShadedBuildings(ctx, [projected], p => p.x * 100, p => p.y * 100);
  assert.ok(calls.includes('fill'));
});

test('static building provider fetches once, uses correct OSM way and produces mesh', async () => {
  let requests=0;
  const provider=createLocalBuildingProvider({
    baseUrl:'https://example.org/hack4gdi_ol/',
    fetchFn:async url=>{
      requests++;
      assert.equal(url,'https://example.org/hack4gdi_ol/assets/buildings/test.geojson');
      return {ok:true,json:async()=>({type:'FeatureCollection',features:[feature({building:'yes',height:'12'})]})};
    }
  });
  const buildingPoi={...poi,building:{enabled:true,url:'./assets/buildings/test.geojson',osmId:'way/42'}};
  const [a,b]=await Promise.all([provider.load(buildingPoi),provider.load(buildingPoi)]);
  assert.equal(requests,1);
  assert.ok(a.faces.length>=5);
  assert.equal(b.osmId,'way/42');
});

test('building manifest only enables generated assets and keeps existing catalog objects', () => {
  const items=[{...poi},{id:'garden',name:'Garden'}];
  const available=applyBuildingManifest(items,{buildings:{test:{file:'test.geojson',osmId:'way/42',defaultHeight:14}}});
  assert.equal(available,1);
  assert.equal(items[0].building.enabled,true);
  assert.equal(items[0].building.url,'./assets/buildings/test.geojson');
  assert.equal(items[1].building,undefined);
});
