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
import {createOSMBuildingsProvider} from './data/providers/osmBuildings.js';
import {createBuildingStream} from './poi/visibilityManager.js';

const $ = id => document.getElementById(id);
const announce = text => {
  $('status').textContent = text;
};

// Gemeinsamer POI-Katalog für AR, Karte und Atlas.
const currentPois = pois;

console.log(`WindowLens: ${currentPois.length} POIs geladen`);

// Vollbild-Kamerabühne und Bottom-Sheet
const stage = $('scene-stage');
const sheet = $('sheet');

const atlas = createAtlas();
const recorder = createJourneyRecorder();

const openPoi = createPoiDetails(
  $('poi-dialog'),
  id => atlas.collect(id),
  announce
);

const video = $('camera');

// Leaflet-Karte mit dem neuen POI-Katalog
const mapPanel = createMapPanel($('map-panel'), {
  pois: currentPois,
  center: [49.9881632, 8.2270956],
  zoom: 12,
  onPoiClick: poi => openPoi(poi),
});

// Sicherstellen, dass alle POIs auf der Karte liegen.
mapPanel.setPois(currentPois);

fetch('./src/data/rail.geojson')
  .then(response => {
    if (!response.ok) {
      throw new Error(`Schienennetz: HTTP ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    mapPanel.addGeoJson(data, {
      color: '#475569',
      weight: 2,
      opacity: 0.8,
    });
  })
  .catch(error => {
    console.warn('Schienennetz konnte nicht geladen werden:', error);
  });

// Gebäudestreaming
const buildingProvider = createOSMBuildingsProvider();

const buildings = createBuildingStream(
  currentPois,
  buildingProvider,
  {
    onStatus: ({loaded, loading, errors}) => {
      $('building-status').textContent =
        `${loaded} Gebäude geladen` +
        (loading ? ` · ${loading} im Abruf` : '') +
        (errors ? ` · ${errors} ohne abrufbares Modell` : '');
    },
  }
);

// AR-Overlay – Video und Canvas füllen die Vollbild-Bühne,
// alle Größenberechnungen laufen automatisch auf 100vw/100vh.
const renderOverlay = createOverlay(
  $('models'),
  $('markers'),
  currentPois,
  openPoi,
  video,
  poi => buildings.getModel(poi)
);

// Kamera
const camera = createCamera(video, active => {
  video.classList.toggle('active', active);
  $('camera-toggle').textContent =
    active ? 'Kamera stoppen' : 'Kamera starten';
  $('switch').disabled = !active;
});

const orientation = createOrientation(announce);

// Position und Fahrtaufzeichnung
let mapCentered = false;

function handlePositionUpdate(fix, status) {
  $('position').textContent =
    fix.source === 'gps'
      ? status
      : 'Mainz · Referenzstandort';

  $('gps').textContent =
    position.active ? 'GPS beenden' : 'GPS aktivieren';

  recorder.sample(fix);

  if (fix.source === 'gps' && !mapCentered) {
    mapPanel.setView(fix.lat, fix.lon);
    mapCentered = true;
  }

  announce(status);
}

const position = createPosition(handlePositionUpdate);
const poses = createPoseProvider(position, orientation);

const value = id => Number($(id).value);

const run = async action => {
  try {
    await action();
  } catch (error) {
    console.error(error);
    announce(error.message);
  }
};

// ============================================================
// Bottom-Sheet im Apple-Maps-Stil
// Drei Zustände: peek (angedeutet), half (halb), full (maximiert).
// Ziehen am Grabber, Tippen auf Grabber und Tastatur (Enter/Leer
// und Pfeiltasten) wechseln zwischen den Zuständen.
// ============================================================
const SHEET_STATES = ['peek', 'half', 'full'];
let sheetState = 'peek';

function setSheetState(state) {
  sheetState = state;
  sheet.className = `sheet sheet--${state}`;
}

function stepSheet(direction) {
  const index = Math.min(
    SHEET_STATES.length - 1,
    Math.max(0, SHEET_STATES.indexOf(sheetState) + direction)
  );
  setSheetState(SHEET_STATES[index]);
}

(() => {
  const grabber = $('sheet-grabber');
  let startY = 0;
  let startTravel = 0;
  let dragging = false;

  const currentTravel = () =>
    window.innerHeight - sheet.getBoundingClientRect().top;

  grabber.addEventListener('pointerdown', event => {
    dragging = true;
    startY = event.clientY;
    startTravel = currentTravel();
    sheet.classList.add('dragging');
    grabber.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  grabber.addEventListener('pointermove', event => {
    if (!dragging) return;
    const delta = startY - event.clientY;
    sheet.style.transform =
      `translate(-50%, calc(100% - ${Math.max(40, startTravel + delta)}px))`;
  });

  const finish = event => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';

    const delta = startY - event.clientY;
    const threshold = 40;

    if (delta > threshold) {
      stepSheet(1);            // nach oben gezogen
    } else if (delta < -threshold) {
      stepSheet(-1);           // nach unten gezogen
    } else {
      // Tippen: zwischen peek und full umschalten
      setSheetState(sheetState === 'peek' ? 'full' : 'peek');
    }
  };

  grabber.addEventListener('pointerup', finish);
  grabber.addEventListener('pointercancel', finish);

  // Tastaturbedienung
  grabber.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSheetState(sheetState === 'peek' ? 'full' : 'peek');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      stepSheet(1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepSheet(-1);
    }
  });

  // Beim Scrollen im Body-Ende des Sheets weiter ausziehen
  // (optional, Apple-Maps-Verhalten; Standard: nur Grabber).
})();

// Kamerasteuerung
async function startCamera(facing) {
  $('camera-toggle').disabled = true;
  try {
    await camera.start(facing);
  } finally {
    $('camera-toggle').disabled = false;
  }
}

function updateManual() {
  $('manual-controls').hidden = !$('manual').checked;
}

$('manual').onchange = updateManual;

$('camera-toggle').onclick = () =>
  run(() => camera.active ? camera.stop() : startCamera());

$('switch').onclick = () =>
  run(() => startCamera(
    camera.facing === 'environment' ? 'user' : 'environment'
  ));

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

// GPS
$('gps').onclick = () => run(() => {
  if (position.active) {
    position.stop();
  } else {
    position.start();
  }

  $('gps').textContent =
    position.active ? 'GPS beenden' : 'GPS aktivieren';
});

// Sensorkalibrierung
$('calibration').onsubmit = event => {
  event.preventDefault();

  run(() => {
    orientation.calibrateHeading(
      value('known-heading'),
      camera.facing
    );

    $('manual').checked = false;
    updateManual();
    announce('Azimut kalibriert.');
  });
};

$('zero').onclick = () => run(() => {
  orientation.zeroPitch(camera.facing);
  announce('Neigung genullt.');
});

$('reset').onclick = () => {
  orientation.reset();
  announce('Kalibrierung zurückgesetzt.');
};

// Fahrtaufzeichnung
$('record').onclick = () => run(() => {
  if (recorder.current) {
    const hasPoints = recorder.current.segments.length > 0;

    recorder.finish(trip => atlas.saveJourney(trip));

    announce(
      hasPoints
        ? 'Fahrt im Atlas gespeichert.'
        : 'Keine verwertbaren Standortpunkte empfangen.'
    );
  } else {
    if (!position.active) position.start();

    $('gps').textContent = 'GPS beenden';
    recorder.start();
    recorder.sample(position.current);

    announce('Fahrtaufzeichnung läuft.');
  }

  $('record').textContent =
    recorder.current ? 'Fahrt beenden' : 'Fahrt starten';
});

// Ansichten: Entdecken (Vollbild-Kamera + Sheet) ↔ Atlas
function showAtlas(visible) {
  if (visible) {
    renderDashboard(
      $('dashboard'),
      atlas.read(),
      currentPois,
      openPoi
    );

    if (camera.active || $('camera-toggle').disabled) {
      camera.stop();
    }
  }

  // Sheet und schwebende Chips verschwinden im Atlas,
  // das Dashboard liegt auf dem normalen Hintergrund.
  $('scene').hidden = visible;
  $('dashboard').hidden = !visible;
  stage.hidden = visible;

  $('explore').setAttribute('aria-pressed', String(!visible));
  $('atlas').setAttribute('aria-pressed', String(visible));
}

$('atlas').onclick = () => run(() => showAtlas(true));
$('explore').onclick = () => showAtlas(false);

// AR-Rendering
function draw() {
  if (!$('scene').hidden) {
    const manual = $('manual').checked
      ? {
          heading: value('heading'),
          pitch: value('pitch'),
        }
      : null;

    const frame = poses.getFrame({
      facing: camera.facing,
      manual,
    });

    buildings.update(frame);

    $('pose').textContent = frame.camera
      ? `${
          frame.camera.heading == null
            ? '—'
            : Math.round(frame.camera.heading) + '°'
        } / ${Math.round(frame.camera.pitch)}°`
      : '— / —';

    renderOverlay(frame, [
      value('hfov'),
      value('vfov')
    ]);

    $('recording').textContent = recorder.current
      ? `${(recorder.current.distanceM / 1000).toFixed(2)} km`
      : '';
  }

  requestAnimationFrame(draw);
}

requestAnimationFrame(draw);

// Ressourcen beim Verlassen freigeben
window.addEventListener('pagehide', () => {
  camera.stop();
  orientation.stop();
  $('sensors').disabled = false;
  position.stop();
});