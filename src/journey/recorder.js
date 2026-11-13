import {distanceAndBearing} from '../ar/geometry.js';

export function createJourneyRecorder() {
  let journey;
  let previous;
  return {
    get current() { return journey; },
    start() {
      previous = null;
      journey = {startedAt: new Date().toISOString(), distanceM: 0, segments: []};
    },
    sample(fix) {
      if (!journey) return;
      if (fix.source !== 'gps' || fix.accuracy > 50) {
        previous = null;
        return;
      }
      if (previous && fix.timestamp <= previous.timestamp) return;
      const elapsed = previous ? (fix.timestamp - previous.timestamp) / 1000 : Infinity;
      const distance = previous && distanceAndBearing(previous.lat, previous.lon, fix.lat, fix.lon)?.distance;
      if (!previous || elapsed > 30 || distance / elapsed > 110) {
        journey.segments.push([]);
      } else {
        // Kleine Änderungen im Bereich der Standortunsicherheit zunächst abwarten.
        if (distance < Math.max(8, (previous.accuracy + fix.accuracy) / 2)) return;
        journey.distanceM += distance;
      }
      journey.segments.at(-1).push({lat: fix.lat, lon: fix.lon, timestamp: fix.timestamp});
      previous = fix;
    },
    finish(save) {
      if (!journey) return;
      if (journey.segments.length) save({...journey, endedAt: new Date().toISOString()});
      journey = null;
      previous = null;
    },
  };
}
