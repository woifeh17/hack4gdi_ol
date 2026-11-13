import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cameraPoseFromEuler, manualCameraPose, projectPoi} from '../src/ar/geometry.js';
import {createJourneyRecorder} from '../src/journey/recorder.js';
import {createAtlas} from '../src/atlas/store.js';

test('Kamera blickt aufrecht bei Alpha null nach Norden', () => {
  const pose = cameraPoseFromEuler(0, 90, 0);
  assert.equal(pose.heading, 0);
  assert.equal(pose.pitch, 0);
  assert.equal(projectPoi(0, 0, pose, 65, 55).x, .5);
});

test('Neigung und Bildausschnitt wirken auf die Projektion', () => {
  assert.ok(projectPoi(20, 0, manualCameraPose(20, 12), 65, 55).y > .5);
  assert.equal(projectPoi(200, 0, manualCameraPose(20, 12), 65, 55), null);
});

test('Eine Standortlücke wird nicht als gefahrene Strecke gezählt', () => {
  const recorder = createJourneyRecorder();
  recorder.start();
  const fix = {source: 'gps', lat: 50, lon: 8, accuracy: 5, timestamp: 1000};
  recorder.sample(fix);
  recorder.sample({...fix, lon: 8.001, timestamp: 11000});
  recorder.sample({...fix, source: 'fallback'});
  recorder.sample({...fix, lon: 8.02, timestamp: 21000});
  recorder.finish(trip => {
    assert.equal(trip.segments.length, 2);
    assert.ok(trip.distanceM > 70 && trip.distanceM < 75);
  });
  assert.equal(recorder.current, null);
});

test('Atlas speichert einen POI einmal und behält Fahrten', () => {
  let saved;
  const storage = {getItem: () => saved, setItem: (_, value) => { saved = value; }};
  const atlas = createAtlas(storage);
  atlas.collect('arena');
  atlas.collect('arena');
  atlas.saveJourney({distanceM: 1250, segments: []});
  assert.equal(createAtlas(storage).read().objects.length, 1);
  assert.equal(createAtlas(storage).read().journeys[0].distanceM, 1250);
});
