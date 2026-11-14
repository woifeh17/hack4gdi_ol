import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createJourneyRecorder} from '../src/journey/recorder.js';
import {createOrientation} from '../src/device/orientation.js';

test('invalid GPS samples cannot contaminate journey distance', () => {
  const recorder = createJourneyRecorder();
  recorder.start();
  const fix = {source: 'gps', lat: 50, lon: 8, accuracy: 5, timestamp: 1000};
  recorder.sample(fix);
  recorder.sample({...fix, lat: NaN, timestamp: 2000});
  recorder.sample({...fix, lat: 50.001, timestamp: 3000});
  assert.equal(recorder.current.distanceM, 0);
  assert.equal(recorder.current.segments.length, 2);
});

test('stopping sensors cancels an outstanding permission request', async t => {
  const original = globalThis.window;
  let grant;
  let listeners = 0;
  globalThis.window = {
    DeviceOrientationEvent: {requestPermission: () => new Promise(resolve => { grant = resolve; })},
    addEventListener() { listeners++; },
    removeEventListener() {},
  };
  t.after(() => { globalThis.window = original; });
  const orientation = createOrientation(() => {});
  const started = orientation.start();
  orientation.stop();
  grant('granted');
  await started;
  assert.equal(orientation.active, false);
  assert.equal(listeners, 0);
});
