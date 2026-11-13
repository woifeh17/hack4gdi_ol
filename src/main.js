import {createCamera} from './device/camera.js';
import {createOrientation} from './device/orientation.js';
import {createPosition} from './device/position.js';
import {createPoseProvider} from './ar/pose.js';
import {createOverlay} from './ar/overlay.js';
import {createMapPanel} from './map/map-panel.js';
import {pois} from './data/mainzTestPois.js';
import {createPoiDetails} from './data/details.js';
import {createAtlas} from './atlas/store.js';
import {renderDashboard} from './atlas/view.js';
import {createJourneyRecorder} from './journey/recorder.js';
import {createLocalBuildingProvider} from './data/providers/localBuildings.js';
import {applyBuildingManifest} from './data/buildingManifest.js';
import {createBuildingStream} from './poi/visibilityManager.js';

const $ = id => document.getElementById(id);
const announce = message => { $('status').textContent = message; };
const currentPois = pois;
console.log(`WindowLens: ${currentPois.length} POIs geladen`);

const atlas = createAtlas();
const recorder = createJourneyRecorder();
const openPoi = createPoiDetails($('poi-dialog'), id => atlas.collect(id), announce);
const video = $('camera');

// POI catalogue stays shared between map, AR and atlas.
const mapPanel = createMapPanel($('map-panel'), {
  pois: currentPois,
  center: [49.9881632, 8.2270956],
  zoom: 12,
  onPoiClick: poi => openPoi(poi),
});

fetch('./src/data/rail.geojson')
  .then(response => {
    if (!response.ok) throw new Error(`Schienennetz: HTTP ${response.status}`);
    return response.json();
  })
  .then(data => mapPanel.addGeoJson(data, {
    color: '#475569', weight: 2, opacity: 0.8,
  }))
  .catch(error => console.warn('Schienennetz konnte nicht geladen werden:', error));

const buildingProvider = createLocalBuildingProvider();
const buildings = createBuildingStream(currentPois, buildingProvider, {
  onStatus: ({loaded, loading, errors}) => {
    $('building-status').textContent =
      `${loaded} Gebäude geladen` +
      (loading ? ` · ${loading} im Abruf` : '') +
      (errors ? ` · ${errors} ohne abrufbares Modell` : '');
  },
});

// Discover only building GeoJSON files that were actually generated and hosted.
// AR, Leaflet and Atlas keep the same POI objects; no live Overpass calls.
fetch('./assets/buildings/manifest.json')
  .then(response => {
    if (!response.ok) throw new Error(`Building manifest: HTTP ${response.status}`);
    return response.json();
  })
  .then(manifest => {
    const available = applyBuildingManifest(currentPois, manifest);
    console.info(`WindowLens: ${available} static OSM buildings available`);
  })
  .catch(error => console.warn('Static building manifest unavailable:', error));

// User preference – off by default; survives page reloads.
const DISTANCE_STORAGE_KEY = 'windowlens.showPoiDistance.v1';
try {
  $('show-poi-distance').checked = localStorage.getItem(DISTANCE_STORAGE_KEY) === 'true';
} catch { /* Private mode can disallow storage. */ }
$('show-poi-distance').addEventListener('change', () => {
  try {
    localStorage.setItem(DISTANCE_STORAGE_KEY, String($('show-poi-distance').checked));
  } catch { /* Preference remains active for this session. */ }
});

const renderOverlay = createOverlay(
  $('models'), $('markers'), currentPois, openPoi, video,
  poi => buildings.getModel(poi),
  {showDistance: () => $('show-poi-distance').checked}
);

// Three-dot settings menu.
const menuRoot = $('menu-root');
function setMenuOpen(open) {
  $('app-menu').hidden = !open;
  $('menu-toggle').setAttribute('aria-expanded', String(open));
  $('menu-toggle').setAttribute('aria-label', open ? 'Einstellungen schließen' : 'Einstellungen öffnen');
  if (!open) $('developer-options').open = false;
}
$('menu-toggle').addEventListener('click', () => setMenuOpen($('app-menu').hidden));
document.addEventListener('pointerdown', event => {
  if (!menuRoot.contains(event.target)) setMenuOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('app-menu').hidden) {
    setMenuOpen(false);
    $('menu-toggle').focus();
  }
});

let cameraRetryNeeded = false;
let gpsRetryNeeded = false;
let sensorNeedsGesture = false;
let sensorStatus = 'Nicht gestartet';
let cameraBusy = false;
let cameraWanted = true;
let autoSwitchToSensors = true;

function syncControls() {
  $('camera-toggle').textContent = camera.active ? 'Kamera stoppen' : 'Kamera aktivieren';
  $('camera-toggle').disabled = cameraBusy;
  $('switch').disabled = !camera.active || cameraBusy;
  $('gps').textContent = position.active ? 'GPS stoppen' : 'GPS aktivieren';
  $('sensors').textContent = orientation.active ? 'Sensoren stoppen' : 'Sensoren aktivieren';
  $('sensor-status').textContent = sensorStatus;
}

function updatePermissionBanner() {
  const needsAction = sensorNeedsGesture || cameraRetryNeeded || gpsRetryNeeded;
  $('permission-banner').hidden = !needsAction;
  if (!needsAction) return;

  const needs = [
    ...(sensorNeedsGesture ? ['Bewegungssensoren'] : []),
    ...(cameraRetryNeeded ? ['Kamera'] : []),
    ...(gpsRetryNeeded ? ['Standort'] : []),
  ];
  $('permission-message').textContent =
    `Für ${needs.join(', ')} ist eine Freigabe oder ein erneuter Start erforderlich.`;
  $('enable-ar').textContent = 'AR aktivieren';
}

const camera = createCamera(video, active => {
  video.classList.toggle('active', active);
  syncControls();
});

const orientation = createOrientation(status => {
  sensorStatus = status;
  $('sensor-status').textContent = status;
  // Give a visible diagnostic for relative-only sensors requiring calibration.
  if (status.includes('Relative') || status.includes('Keine Sensordaten')) announce(status);
});

let mapCentered = false;
function handlePositionUpdate(fix, status) {
  $('position').textContent = fix.source === 'gps' ? status : 'Mainz · Referenzstandort';
  recorder.sample(fix);
  if (fix.source === 'gps' && !mapCentered) {
    mapPanel.setView(fix.lat, fix.lon);
    mapCentered = true;
  }
  if (status.includes('Standortzugriff verweigert')) gpsRetryNeeded = true;
  if (fix.source === 'gps') gpsRetryNeeded = false;
  syncControls();
  updatePermissionBanner();
  announce(status);
}
const position = createPosition(handlePositionUpdate);
const poses = createPoseProvider(position, orientation);
const value = id => Number($(id).value);

const run = async action => {
  try { await action(); }
  catch (error) {
    console.error(error);
    announce(error.message || String(error));
  }
};

async function startCamera(facing = 'environment') {
  if (cameraBusy) return;
  cameraBusy = true;
  syncControls();
  try {
    await camera.start(facing);
    cameraRetryNeeded = false;
  } catch (error) {
    cameraRetryNeeded = true;
    announce(`Kamera: ${error.message}`);
    console.warn('Kamera nicht automatisch gestartet:', error);
  } finally {
    cameraBusy = false;
    syncControls();
    updatePermissionBanner();
  }
}

function startGps() {
  try {
    if (!position.active) position.start();
    gpsRetryNeeded = false;
  } catch (error) {
    gpsRetryNeeded = true;
    announce(`Standort: ${error.message}`);
    console.warn('GPS nicht automatisch gestartet:', error);
  }
  syncControls();
  updatePermissionBanner();
}

async function startSensors(userGesture = false) {
  if (orientation.active) return;
  const api = window.DeviceOrientationEvent;
  if (!api) {
    sensorNeedsGesture = false;
    sensorStatus = 'Keine Orientierungssensoren verfügbar – manuelle Blickrichtung nutzen.';
    syncControls();
    return;
  }

  // iOS requires requestPermission() from a real tap, even when site loading.
  if (typeof api.requestPermission === 'function' && !userGesture) {
    sensorNeedsGesture = true;
    sensorStatus = 'Zum Aktivieren der Sensoren bitte „AR aktivieren“ antippen.';
    syncControls();
    updatePermissionBanner();
    return;
  }

  try {
    // IMPORTANT: orientation.start() is called synchronously within the
    // click handler before any await (needed for iOS transient activation).
    await orientation.start();
    sensorNeedsGesture = false;
    sensorStatus = 'Sensoren aktiv – warte auf verwertbare Orientierung.';
    autoSwitchToSensors = true;
  } catch (error) {
    sensorNeedsGesture = typeof api.requestPermission === 'function';
    sensorStatus = `Sensoren: ${error.message}`;
    console.warn('Orientierungssensoren nicht gestartet:', error);
  } finally {
    syncControls();
    updatePermissionBanner();
  }
}

// One-tap fallback for permissions blocked during automatic startup.
$('enable-ar').addEventListener('click', () => {
  // First call runs within user activation; do not await camera or GPS here.
  if (!orientation.active) void startSensors(true);
  if (!camera.active && !cameraBusy) void startCamera();
  if (!position.active) startGps();
});

$('camera-toggle').addEventListener('click', () => {
  if (camera.active) {
    cameraWanted = false;
    camera.stop();
    cameraRetryNeeded = false;
    syncControls();
    updatePermissionBanner();
  } else {
    cameraWanted = true;
    void startCamera();
  }
});
$('switch').addEventListener('click', () => {
  cameraWanted = true;
  void startCamera(camera.facing === 'environment' ? 'user' : 'environment');
});
$('gps').addEventListener('click', () => {
  if (position.active) {
    position.stop();
    gpsRetryNeeded = false;
    syncControls();
    updatePermissionBanner();
  } else startGps();
});
$('sensors').addEventListener('click', () => {
  if (orientation.active) {
    orientation.stop();
    sensorStatus = 'Sensoren ausgeschaltet; manuelle Blickrichtung aktiv.';
    $('manual').checked = true;
    autoSwitchToSensors = false;
    updateManual();
    sensorNeedsGesture = false;
    syncControls();
    updatePermissionBanner();
  } else {
    // Do not wrap this in an awaited helper before requestPermission().
    void startSensors(true);
  }
});

function updateManual() {
  $('manual-controls').hidden = !$('manual').checked;
}
$('manual').addEventListener('change', () => {
  // Respect explicit user input; don't override manual mode later.
  autoSwitchToSensors = false;
  updateManual();
});
updateManual();

$('calibration').addEventListener('submit', event => {
  event.preventDefault();
  void run(() => {
    orientation.calibrateHeading(value('known-heading'), camera.facing);
    $('manual').checked = false;
    autoSwitchToSensors = false;
    updateManual();
    announce('Azimut kalibriert.');
  });
});
$('zero').addEventListener('click', () => void run(() => {
  orientation.zeroPitch(camera.facing);
  announce('Neigung genullt.');
}));
$('reset').addEventListener('click', () => {
  orientation.reset();
  announce('Kalibrierung zurückgesetzt.');
});

$('record').addEventListener('click', () => void run(() => {
  if (recorder.current) {
    const hasPoints = recorder.current.segments.length > 0;
    recorder.finish(trip => atlas.saveJourney(trip));
    announce(hasPoints ? 'Fahrt im Atlas gespeichert.' : 'Keine verwertbaren Standortpunkte empfangen.');
  } else {
    if (!position.active) startGps();
    recorder.start();
    recorder.sample(position.current);
    announce('Fahrtaufzeichnung läuft.');
  }
  $('record').textContent = recorder.current ? 'Fahrt beenden' : 'Fahrt starten';
}));

function showAtlas(visible) {
  setMenuOpen(false);
  if (visible) {
    renderDashboard($('dashboard'), atlas.read(), currentPois, openPoi);
    if (camera.active) camera.stop();
  }
  $('scene').hidden = visible;
  $('dashboard').hidden = !visible;
  $('explore').setAttribute('aria-pressed', String(!visible));
  $('atlas').setAttribute('aria-pressed', String(visible));
  // Restore the camera when returning to AR, unless the user disabled it.
  if (!visible && cameraWanted && !camera.active && !cameraBusy) void startCamera();
  syncControls();
}
$('atlas').addEventListener('click', () => showAtlas(true));
$('explore').addEventListener('click', () => showAtlas(false));

function draw() {
  if (!$('scene').hidden) {
    // Switch from demonstration heading to real absolute orientation only
    // when a valid sensor pose actually exists (relative-only sensors need calibration).
    if (autoSwitchToSensors && orientation.active && $('manual').checked &&
        orientation.getPose({facing: camera.facing, manual: null})) {
      $('manual').checked = false;
      autoSwitchToSensors = false;
      updateManual();
    }

    const manual = $('manual').checked
      ? {heading: value('heading'), pitch: value('pitch')}
      : null;
    const frame = poses.getFrame({facing: camera.facing, manual});
    buildings.update(frame);
    $('pose').textContent = frame.camera
      ? `${frame.camera.heading == null ? '—' : Math.round(frame.camera.heading) + '°'} / ${Math.round(frame.camera.pitch)}°`
      : '— / —';
    renderOverlay(frame, [value('hfov'), value('vfov')]);
    $('recording').textContent = recorder.current
      ? `${(recorder.current.distanceM / 1000).toFixed(2)} km` : '';
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

window.addEventListener('pagehide', () => {
  camera.stop();
  orientation.stop();
  position.stop();
});

// Automatic startup: camera, geolocation and (where allowed) sensors.
// Browsers can still prompt or deny access; the banner offers a retry.
syncControls();
startGps();
void startCamera();
void startSensors(false);
