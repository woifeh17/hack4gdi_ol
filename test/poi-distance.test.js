import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatPoiDistance} from '../src/ar/formatDistance.js';

test('Formats POI distance consistently', () => {
  assert.equal(formatPoiDistance(0), '0 m');
  assert.equal(formatPoiDistance(299.6), '300 m');
  assert.equal(formatPoiDistance(998), '998 m');
  assert.equal(formatPoiDistance(1000), '1,0 km');
  assert.equal(formatPoiDistance(1530), '1,5 km');
  assert.equal(formatPoiDistance(NaN), '—');
});
