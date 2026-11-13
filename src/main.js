import {createCamera} from './device/camera.js';
import {createOrientation} from './device/orientation.js';
import {createPosition} from './device/position.js';
import {createPoseProvider} from './ar/pose.js';
import {createOverlay} from './ar/overlay.js';
import {pois} from './data/pois.js';
import {createPoiDetails} from './data/details.js';
import {createAtlas} from './atlas/store.js';
import {renderDashboard} from './atlas/view.js';
import {createJourneyRecorder} from './journey/recorder.js';

const $ = id => document.getElementById(id);
const announce = text => { $('status').textContent = text; };
const atlas = createAtlas();
const recorder = createJourneyRecorder();
const openPoi = createPoiDetails($('poi-dialog'), id => atlas.collect(id), announce);
const video = $('camera');
const renderOverlay = createOverlay($("models"), $("markers"), pois, openPoi, video);
const camera = createCamera(video, active => {
  video.classList.toggle('active', active);
  $('camera-toggle').textContent = active ? 'Kamera stoppen' : 'Kamera starten';
  $('switch').disabled = !active;
});
const orientation = createOrientation(announce);
const position = createPosition((fix, status) => {
  $('position').textContent = fix.source === 'gps' ? status : 'Mainz · Referenzstandort';
  $('gps').textContent = position.active ? 'GPS beenden' : 'GPS aktivieren';
  recorder.sample(fix);
  announce(status);
});
const poses = createPoseProvider(position, orientation);
const value = id => Number($(id).value);
const run = async action => {
  try { await action(); }
  catch (error) { announce(error.message); }
};

async function startCamera(facing) {
  $('camera-toggle').disabled = true;
  try { await camera.start(facing); }
  finally { $('camera-toggle').disabled = false; }
}

function updateManual() {
  $('manual-controls').hidden = !$('manual').checked;
}
$('manual').onchange = updateManual;
$('camera-toggle').onclick = () => run(() => camera.active ? camera.stop() : startCamera());
$('switch').onclick = () => run(() => startCamera(camera.facing === 'environment' ? 'user' : 'environment'));
$('sensors').onclick = () => run(async () => {
  $('sensors').disabled = true;
  try {
    await orientation.start();
    $('manual').checked = false;
    updateManual();
  } catch (error) {
    $('sensors').disabled = false;
    throw error;
  }
});
$('gps').onclick = () => run(() => {
  if (position.active) position.stop();
  else position.start();
  $('gps').textContent = position.active ? 'GPS beenden' : 'GPS aktivieren';
});
$('calibration').onsubmit = event => {
  event.preventDefault();
  run(() => {
    orientation.calibrateHeading(value('known-heading'), camera.facing);
    $('manual').checked = false;
    updateManual();
    announce('Azimut kalibriert.');
  });
};
$('zero').onclick = () => run(() => {
  orientation.zeroPitch(camera.facing);
  announce('Neigung genullt.');
});
$('reset').onclick = () => { orientation.reset(); announce('Kalibrierung zurückgesetzt.'); };
$('record').onclick = () => run(() => {
  if (recorder.current) {
    const hasPoints = recorder.current.segments.length > 0;
    recorder.finish(trip => atlas.saveJourney(trip));
    announce(hasPoints ? 'Fahrt im Atlas gespeichert.' : 'Keine verwertbaren Standortpunkte empfangen.');
  } else {
    if (!position.active) position.start();
    $('gps').textContent = 'GPS beenden';
    recorder.start();
    recorder.sample(position.current);
    announce('Fahrtaufzeichnung läuft. Zum Speichern die Fahrt beenden.');
  }
  $('record').textContent = recorder.current ? 'Fahrt beenden' : 'Fahrt starten';
});

function showAtlas(visible) {
  if (visible) {
    renderDashboard($('dashboard'), atlas.read(), pois, openPoi);
    if (camera.active || $('camera-toggle').disabled) camera.stop();
  }
  $('scene').hidden = visible;
  $('dashboard').hidden = !visible;
  $('explore').setAttribute('aria-pressed', String(!visible));
  $('atlas').setAttribute('aria-pressed', String(visible));
}
$('atlas').onclick = () => run(() => showAtlas(true));
$('explore').onclick = () => showAtlas(false);

function draw() {
  if (!$('scene').hidden) {
    const manual = $('manual').checked ? {heading: value('heading'), pitch: value('pitch')} : null;
    const frame = poses.getFrame({facing: camera.facing, manual});
    $('pose').textContent = frame.camera
      ? `${frame.camera.heading == null ? '—' : Math.round(frame.camera.heading) + '°'} / ${Math.round(frame.camera.pitch)}°`
      : '— / —';
    renderOverlay(frame, [value('hfov'), value('vfov')]);
    $('recording').textContent = recorder.current ? `${(recorder.current.distanceM / 1000).toFixed(2)} km` : '';
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
window.addEventListener('pagehide', () => {
  camera.stop();
  orientation.stop();
  $('sensors').disabled = false;
  position.stop();
});
