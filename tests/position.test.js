import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPosition} from '../src/device/position.js';

test('GPS can be restarted after denial and ignores callbacks from the old watch', t => {
  const oldWindow = globalThis.window;
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const watches = [];
  const cleared = [];
  globalThis.window = {isSecureContext: true};
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {geolocation: {
      watchPosition(success, failure) {
        watches.push({success, failure});
        return watches.length;
      },
      clearWatch(id) { cleared.push(id); },
    }},
  });
  t.after(() => {
    globalThis.window = oldWindow;
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else delete globalThis.navigator;
  });

  const updates = [];
  const position = createPosition((fix, status, error) => updates.push({fix, error}));
  position.start();
  assert.equal(position.active, true);
  watches[0].failure({code: 1});
  assert.equal(position.active, false);
  assert.equal(updates.at(-1).error, 'denied');
  assert.deepEqual(cleared, [1]);

  position.start();
  const sample = {coords: {latitude: 50, longitude: 8, accuracy: 900}, timestamp: 1000};
  watches[0].success(sample);
  assert.equal(position.current.source, 'fallback');
  watches[1].success(sample);
  assert.equal(position.current.source, 'gps');
  assert.equal(position.current.coarse, true);
  position.stop();
});

