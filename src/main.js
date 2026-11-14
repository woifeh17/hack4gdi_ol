import {createCamera} from './device/camera.js';
import {createOrientation} from './device/orientation.js';
import {createPosition} from './device/position.js';
import {createPoseProvider} from './ar/pose.js';
import {createOverlay} from './ar/overlay.js';
import {createMapPanel} from './map/map-panel.js';
import {pois} from './data/mainzTestPois.js';
import {poiEnrichment} from './data/poiEnrichment.js';
import {createPoiDetails} from './data/details.js';
import {createAtlas} from './atlas/store.js';
import {renderDashboard} from './atlas/view.js';
import {createJourneyRecorder} from './journey/recorder.js';
import {createLocalBuildingProvider} from './data/providers/localBuildings.js';
import {applyBuildingManifest} from './data/buildingManifest.js';
import {applyLod2Manifest, createLod2BuildingProvider} from './data/providers/lod2Buildings.js';
import {createBuildingStream} from './poi/visibilityManager.js';

const $ = id => document.getElementById(id);
const announce = message => { $('status').textContent = message; };
const currentPois = pois.map(poi => ({
  ...poi,
  ...(poiEnrichment[poi.id] ?? {}),
}));
console.log(`WindowLens: ${currentPois.length} POIs geladen`);

const atlas = createAtlas();
const recorder = createJourneyRecorder();
const collectedPoiIds = () => {
  try {
    return atlas.read().objects.map(entry => entry.poiId);
  } catch {
    return [];
  }
};
const syncCollectedPois = () => mapPanel?.setCollected(collectedPoiIds());
const openPoi = createPoiDetails($('poi-dialog'), id => {
  atlas.collect(id);
  syncCollectedPois();
}, announce, id => collectedPoiIds().includes(id));
const video = $('camera');
const stage = $('scene-stage');
const sheet = $('sheet');

const mapPanel = window.L ? createMapPanel($('map-panel'), {
  pois: currentPois,
  center: [49.9881632, 8.2270956],
  zoom: 12,
  collectedIds: collectedPoiIds(),
  onPoiClick: poi => openPoi(poi, { collectable: false }),
  onRouteRequest: (from, to) => {
    console.log('Route angefragt:', from.properties.Bezeichnung, '→', to.properties.Bezeichnung);
  },
}) : null;

// Sicherstellen, dass alle POIs auf der Karte liegen.
if (mapPanel) {
  mapPanel.setPois(currentPois);

  fetch('./src/data/rail.geojson')
    .then(response => {
      if (!response.ok) throw new Error(`Schienennetz: HTTP ${response.status}`);
      return response.json();
    })
    .then(data => mapPanel.addGeoJson(data, {
      color: '#475569', weight: 2, opacity: 0.8,
    }))
    .catch(error => console.warn('Schienennetz konnte nicht geladen werden:', error));

  fetch('./src/data/stations.geojson')
    .then(response => {
      if (!response.ok) {
        throw new Error(`Bahnhöfe: HTTP ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      mapPanel.addStations(data);
    })
    .catch(error => {
      console.warn('Bahnhöfe konnten nicht geladen werden:', error);
    });
} else {
  $('map-panel').textContent = 'Karte derzeit nicht verfügbar.';
}

// ============================================================
// Gebäudestreaming: LoD2 mit OSM-Fallback.
// ============================================================
const buildingProvider = createLod2BuildingProvider(createLocalBuildingProvider());
const buildings = createBuildingStream(currentPois, buildingProvider, {
  onStatus: ({loaded, loading, errors}) => {
    $('building-status').textContent =
      `${loaded} Gebäude geladen` +
      (loading ? ` · ${loading} im Abruf` : '') +
      (errors ? ` · ${errors} ohne abrufbares Modell` : '');
  },
});

async function loadBuildingManifest(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn(`Building manifest unavailable at ${path}:`, error);
    return null;
  }
}

Promise.all([
  loadBuildingManifest('./assets/buildings/manifest.json'),
  loadBuildingManifest('./assets/buildings/lod2/manifest.json'),
]).then(([osmManifest, lod2Manifest]) => {
  const osm = applyBuildingManifest(currentPois, osmManifest);
  const lod2 = applyLod2Manifest(currentPois, lod2Manifest);
  console.info(`WindowLens: ${lod2} LoD2 POIs, ${osm} POIs with OSM geometry`);
});

// User preferences – off by default; survive page reloads.
const DISTANCE_STORAGE_KEY = 'windowlens.showPoiDistance.v1';
try {
  $('show-poi-distance').checked = localStorage.getItem(DISTANCE_STORAGE_KEY) === 'true';
} catch { /* Private mode can disallow storage. */ }
$('show-poi-distance').addEventListener('change', () => {
  try {
    localStorage.setItem(DISTANCE_STORAGE_KEY, String($('show-poi-distance').checked));
  } catch { /* Preference remains active for this session. */ }
});

// Transparente Glasflächen (Performance-Modus). Die 24px-Backdrop-Blur-
// Effekte über der laufenden Kamera sind auf Mittelklasse-Smartphones
// extrem teuer; ohne sie laufen Marker, Sheet und Header als Vollflächen.
const GLASS_STORAGE_KEY = 'windowlens.glassSurfaces.v1';
const applyGlassPreference = () => {
  if ($('glass-surfaces').checked) delete document.documentElement.dataset.glass;
  else document.documentElement.dataset.glass = 'off';
};
try {
  $('glass-surfaces').checked = localStorage.getItem(GLASS_STORAGE_KEY) !== 'off';
} catch { /* Private mode can disallow storage. */ }
$('glass-surfaces').addEventListener('change', () => {
  try {
    localStorage.setItem(GLASS_STORAGE_KEY, $('glass-surfaces').checked ? 'on' : 'off');
  } catch { /* Preference remains active for this session. */ }
  applyGlassPreference();
});
applyGlassPreference();

// AR-Overlay – nur eine einzige Instanz
const renderOverlay = createOverlay(
  $('models'), $('markers'), currentPois, openPoi, video,
  poi => buildings.getModel(poi),
  {showDistance: () => $('show-poi-distance').checked}
);

// Theme-Schalter: initialen ARIA-Zustand mit dem
// tatsächlich geladenen Theme synchronisieren.
(() => {
  const toggle = $('theme-toggle');
  const light = document.documentElement.dataset.theme === 'light';
  toggle.setAttribute('aria-checked', String(light));
  toggle.setAttribute(
    'aria-label',
    light ? 'Dunkles Design aktivieren' : 'Helles Design aktivieren'
  );
})();

// ============================================================
// Bottom-Sheet im Apple-Maps-Stil
// Drei Zustände: peek (angedeutet), half (halb), full (maximiert).
// Ziehen am Grabber, Tippen auf Grabber und Tastatur wechseln
// zwischen den Zuständen.
// ============================================================
const grabber = $('sheet-grabber');
const sheetBody = $('sheet-body');
// HUD-Chips (Standort/Blickrichtung), die über dem Sheet schweben.
const hudDock = $('hud-dock');
const hudHeader = document.querySelector('.header');
const SHEET_STATES = ['peek', 'half', 'full'];
let sheetState = 'peek';
let sheetTimer = null;

function resizeMapAfterSheetChange() {
  // Leaflet-Karte hängt im Sheet-Body: Nach jeder
  // Größenänderung neu messen lassen, sonst bleiben
  // Kacheln leer oder verschieben sich.
  window.clearTimeout(sheetTimer);
  sheetTimer = window.setTimeout(
    () => mapPanel?.invalidate(),
    500
  );
}

function setSheetState(state) {
  sheetState = state;
  sheet.className = `sheet sheet--${state}`;
  grabber.setAttribute('aria-expanded', String(state !== 'peek'));
  sheetBody.inert = state === 'peek';
  // Voll ausgefahren: HUD-Chips verschwinden garantiert.
  hudDock.classList.toggle('hud-dock--hidden', state === 'full');

  // Bei full Sheet: Karte auf volle Höhe ausdehnen
  if (mapPanel) {
    mapPanel.setOpen(state === 'full');
  }

  resizeMapAfterSheetChange();
}

function stepSheet(direction) {
  const index = Math.min(
    SHEET_STATES.length - 1,
    Math.max(0, SHEET_STATES.indexOf(sheetState) + direction)
  );
  setSheetState(SHEET_STATES[index]);
}

(() => {
  let startY = 0;
  let startTravel = 0;
  let dragging = false;
  let suppressClick = false;

  const currentTravel = () =>
    window.innerHeight - sheet.getBoundingClientRect().top;

  grabber.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick = false;
    dragging = true;
    startY = event.clientY;
    startTravel = currentTravel();
    sheet.classList.add('dragging');
    grabber.setPointerCapture(event.pointerId);
  });

  grabber.addEventListener('pointermove', event => {
    if (!dragging) return;
    const delta = startY - event.clientY;
    sheet.style.transform =
      `translate(-50%, calc(100% - ${Math.max(40, startTravel + delta)}px))`;
  });

  grabber.addEventListener('pointerup', event => {
    if (!dragging) return;
    const delta = startY - event.clientY;
    dragging = false;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    const threshold = 40;

    if (Math.abs(delta) > threshold) {
      suppressClick = true;
      stepSheet(delta > 0 ? 1 : -1);
    }
  });

  grabber.addEventListener('pointercancel', () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
  });

  grabber.addEventListener('click', event => {
    if (suppressClick && event.detail > 0) return;
    setSheetState(sheetState === 'peek' ? 'full' : 'peek');
  });
  grabber.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      stepSheet(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepSheet(-1);
    }
  });
})();

// Das Drei-Punkte-Menü wurde mit dem UI-Redesign aus index.html entfernt;
// die Einstellungen liegen jetzt direkt im Sheet. Der alte Menü-Code hier
// griff weiterhin auf $('menu-root') / $('menu-toggle') / $('app-menu') zu
// und ließ das gesamte Modul beim Start mit einem TypeError sterben.

// ============================================================
// Geräte: Kamera, Sensoren, GPS.
// ============================================================
let cameraRetryNeeded = false;
let gpsRetryNeeded = false;
let gpsMessage = '';
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
  $('permission-gps').hidden = !gpsRetryNeeded || !(sensorNeedsGesture || cameraRetryNeeded);
  const gpsStatus = $('permission-gps-status');
  gpsStatus.textContent = $('permission-gps').hidden ? '' : gpsMessage;
  gpsStatus.hidden = !gpsStatus.textContent;
  if (!needsAction) return;

  const action = sensorNeedsGesture
    ? ['Bewegungssensoren für die AR-Ansicht freigeben.', 'Sensoren aktivieren']
    : cameraRetryNeeded
      ? ['Kamera für die AR-Ansicht freigeben.', 'Kamera aktivieren']
      : [gpsMessage || 'Standort für die AR-Ansicht freigeben.', 'GPS aktivieren'];
  $('permission-message').textContent = action[0];
  $('enable-ar').textContent = action[1];
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
function handlePositionUpdate(fix, status, error) {
  // Standort-Chip zeigt nur die aktuelle Positionsgenauigkeit.
  $('position').textContent =
    fix.source === 'gps' && Number.isFinite(fix.accuracy)
      ? `±${Math.round(fix.accuracy)} m`
      : '—';
  // Karte nutzt denselben Standort-Service; der Mainz-Fallback wird nicht
  // als vermeintlicher GPS-Fix eingezeichnet.
  const hasGpsFix = fix.source === 'gps' &&
    Number.isFinite(fix.lat) && Number.isFinite(fix.lon);
  mapPanel?.setLocation(hasGpsFix ? fix.lat : null, hasGpsFix ? fix.lon : null);
  recorder.sample(fix);
  mapPanel?.setLocation(fix);
  if (fix.source === 'gps' && !mapCentered) {
    mapPanel?.setView(fix.lat, fix.lon);
    mapCentered = true;
  }
  if (error) {
    gpsRetryNeeded = true;
    gpsMessage = status;
  }
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

function startGps(userGesture = false) {
  try {
    gpsRetryNeeded = false;
    gpsMessage = '';
    if (!position.active) position.start({userGesture});
  } catch (error) {
    gpsRetryNeeded = true;
    gpsMessage = error.message;
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
    sensorStatus = 'Zum Aktivieren der Sensoren bitte „Sensoren aktivieren“ antippen.';
    syncControls();
    updatePermissionBanner();
    return;
  }

  try {
    // IMPORTANT: orientation.start() is called synchronously within the
    // click handler before any await (needed for iOS transient activation).
    await orientation.start();
    if (!orientation.active) return;
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

// GPS stays available even if another permission is denied.
$('permission-gps').addEventListener('click', () => startGps(true));

// Each permission starts in its own click handler, before any await.
$('enable-ar').addEventListener('click', () => {
  if (sensorNeedsGesture) void startSensors(true);
  else if (cameraRetryNeeded) void startCamera();
  else if (gpsRetryNeeded) startGps(true);
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
  } else startGps(true);
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
    if (!position.active) startGps(true);
    recorder.start();
    recorder.sample(position.current);
    announce('Fahrtaufzeichnung läuft.');
  }
  $('record').textContent = recorder.current ? 'Fahrt beenden' : 'Fahrt starten';
}));

function showAtlas(visible) {
  const data = visible ? atlas.read() : null;
  if (visible && camera.active) camera.stop();
  stage.hidden = visible;
  $('scene').hidden = visible;
  $('dashboard').hidden = !visible;
  if (visible) renderDashboard($('dashboard'), data, currentPois, openPoi);
  $('explore').setAttribute('aria-pressed', String(!visible));
  $('atlas').setAttribute('aria-pressed', String(visible));
  // Restore the camera when returning to AR, unless the user disabled it.
  if (!visible && cameraWanted && !camera.active && !cameraBusy) void startCamera();
  syncControls();
  if (!visible) resizeMapAfterSheetChange();
}
$('atlas').addEventListener('click', () => void run(() => showAtlas(true)));
$('explore').addEventListener('click', () => showAtlas(false));

// ============================================================
// HUD-Dock: Standort- und Blickrichtungs-Chips folgen dem Sheet.
// `bottom` wird jeden Frame aus der sichtbaren Sheet-Höhe
// berechnet, dadurch bewegen sich die Chips auch beim Ziehen
// live mit. Im Full-Zustand und ohne Platz über dem Sheet
// werden sie ausgeblendet.
// ============================================================
function trackHudOverSheet() {
  const sheetTop = sheet.getBoundingClientRect().top;
  hudDock.style.bottom = `calc(${window.innerHeight - sheetTop}px + .75rem)`;
  const room = sheetTop - (hudHeader ? hudHeader.getBoundingClientRect().bottom : 0);
  hudDock.classList.toggle(
    'hud-dock--hidden',
    sheetState === 'full' || room < hudDock.offsetHeight + 16
  );
}

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
    // Blickrichtungs-Chip zeigt nur den Azimut in Grad.
    $('pose').textContent = frame.camera
      ? (frame.camera.heading == null ? '—' : `${Math.round(frame.camera.heading)}°`)
      : '—';
    renderOverlay(frame, [value('hfov'), value('vfov')]);
    $('recording').textContent = recorder.current
      ? `${(recorder.current.distanceM / 1000).toFixed(2)} km` : '';
  }
  trackHudOverSheet();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

window.addEventListener('pagehide', () => {
  camera.stop();
  orientation.stop();
  position.stop();
});

// Browsers that require a gesture for orientation use the permission banner.
const needsGestureForSensors = typeof window.DeviceOrientationEvent?.requestPermission === 'function';
if (needsGestureForSensors) {
  cameraRetryNeeded = true;
  gpsRetryNeeded = true;
} else {
  void (async () => {
    await startCamera();
    startGps();
  })();
}
syncControls();
void startSensors(false);