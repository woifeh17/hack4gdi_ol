import {cameraPoseFromCompass, cameraPoseFromEuler, manualCameraPose, normalize360} from '../ar/geometry.js';

// Zeitkonstanten der Glättung (in Sekunden): Klein = schnell/träge-arm,
// groß = stark glättend. Bei ruhiger Hand stark glätten (Rauschen wird
// weggedämpft), nur bei echten Sprüngen (> 20° pro Messung) zügig
// nachziehen. Orientiert am typischen 60-Hz-Sensorrhythmus.
const HEADING_TAU = 0.15;
const PITCH_TAU = 0.2;
const JUMP_TAU = 0.06;
const JUMP_THRESHOLD_DEG = 35;

export function createOrientation(onStatus) {
  let sample, timer;
  let active = false;
  let yaw = null;
  let pitch = 0;
  const filter = {heading: null, pitch: null, lastTime: null};
  let lastAccuracyWarning = 0;

  function receive(event) {
    if (![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return;
    let absolute = event.absolute || event.type === 'deviceorientationabsolute';
    let alpha = event.alpha;
    let compass = null;
    // iOS/Safari: kein deviceorientationabsolute, kein verlässliches
    // event.absolute. Der absolute Kompasskurs steckt im nicht-Standard-
    // Feld webkitCompassHeading. Er wird NICHT mehr als alpha missbraucht,
    // sondern über die neigungskompensierte Pose ausgewertet.
    if (!absolute && Number.isFinite(event.webkitCompassHeading)) {
      absolute = true;
      compass = event.webkitCompassHeading;
    }
    if (!absolute && sample?.absolute && performance.now() - sample.time < 3000) return;
    const first = !sample || sample.absolute !== absolute;
    sample = {alpha, beta: event.beta, gamma: event.gamma, compass, absolute, time: performance.now()};
    if (first) {
      yaw = null;
      filter.heading = null;
      filter.pitch = null;
      filter.lastTime = null;
      onStatus(absolute ? 'Absolute Orientierung aktiv.' : 'Relative Orientierung aktiv. Bitte Azimut kalibrieren.');
    }
    // Magnetometer-Störung erkennen (Metall, Elektronik, elektrische
    // Anlagen – in einem Zug praktisch vorprogrammiert).
    const accuracy = event.webkitCompassAccuracy;
    if (Number.isFinite(accuracy) && accuracy > 25 && performance.now() - lastAccuracyWarning > 10000) {
      lastAccuracyWarning = performance.now();
      onStatus(`Kompass stark gestört (±${Math.round(accuracy)}°). Metall oder elektrische Anlagen verfälschen die Blickrichtung; iOS-Kompass einmal kalibrieren (Figure-8) hilft.`);
    }
  }

  function smoothPose(pose, facing) {
    if (!pose) return null;
    const now = performance.now();
    const dt = filter.lastTime == null ? 0.05 : Math.max(0.001, (now - filter.lastTime) / 1000);
    filter.lastTime = now;
    // Degenerierte Kompasslage (Oberkante senkrecht): letzten Kurs halten.
    if (pose.heading == null && filter.heading != null) pose.heading = filter.heading;
    if (pose.heading == null) return pose;
    if (filter.heading == null) {
      filter.heading = pose.heading;
    } else {
      // Kürzester Weg um die 360°-Kante (kein Sprung von 359° auf 0°).
      const delta = normalize360(pose.heading - filter.heading + 180) - 180;
      const tau = Math.abs(delta) > JUMP_THRESHOLD_DEG ? JUMP_TAU : HEADING_TAU;
      filter.heading = normalize360(filter.heading + delta * (1 - Math.exp(-dt / tau)));
    }
    if (filter.pitch == null) {
      filter.pitch = pose.pitch;
    } else {
      const delta = pose.pitch - filter.pitch;
      const tau = Math.abs(delta) > JUMP_THRESHOLD_DEG ? JUMP_TAU : PITCH_TAU;
      filter.pitch += delta * (1 - Math.exp(-dt / tau));
    }
    // Pose aus den geglätteten Werten neu aufbauen: rollfrei und
    // konsistent für POI-Projektion und Gebäudezeichnung.
    let heading = filter.heading;
    if (facing === 'user') heading = normalize360(heading + 180);
    const rebuilt = manualCameraPose(heading, filter.pitch);
    rebuilt.heading = heading;
    rebuilt.pitch = filter.pitch;
    return rebuilt;
  }

  function rawPose(facing, yawOffset = 0, pitchOffset = 0) {
    if (!sample || performance.now() - sample.time > 4000) return null;
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    const pose = sample.compass != null
      ? cameraPoseFromCompass(sample.beta, sample.gamma, sample.compass, angle, yawOffset, pitchOffset, facing)
      : cameraPoseFromEuler(sample.alpha, sample.beta, sample.gamma, angle, yawOffset, pitchOffset, facing);
    return smoothPose(pose, facing);
  }

  return {
    async start() {
      const api = window.DeviceOrientationEvent;
      if (!api) throw new Error('Orientierungssensoren werden hier nicht unterstützt.');
      // iOS verlangt requestPermission() ohne Argument und nur aus einer
      // echten Nutzergeste heraus (siehe startSensors in main.js).
      if (api.requestPermission && await api.requestPermission() !== 'granted') {
        throw new Error('Sensorberechtigung verweigert.');
      }
      active = true;
      window.addEventListener('deviceorientationabsolute', receive);
      window.addEventListener('deviceorientation', receive);
      onStatus('Warte auf Orientierungsdaten …');
      timer = setTimeout(() => { if (!sample) onStatus('Keine Sensordaten. Manuelle Blickrichtung verfügbar.'); }, 2500);
    },
    stop() {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('deviceorientationabsolute', receive);
      window.removeEventListener('deviceorientation', receive);
      sample = null;
      yaw = null;
      pitch = 0;
      filter.heading = null;
      filter.pitch = null;
      filter.lastTime = null;
    },
    get active() { return active; },
    getPose({facing, manual}) {
      if (manual) return manualCameraPose(manual.heading, manual.pitch);
      const pose = rawPose(facing, yaw ?? 0, pitch);
      return pose && (sample.absolute || yaw !== null) ? pose : null;
    },
    calibrateHeading(heading, facing) {
      const pose = rawPose(facing, 0, pitch);
      if (pose?.heading == null) throw new Error('Kamera annähernd waagerecht halten und Sensorwerte abwarten.');
      yaw = normalize360(heading - pose.heading);
    },
    zeroPitch(facing) {
      const pose = rawPose(facing);
      if (!pose) throw new Error('Bitte zuerst Sensordaten abwarten.');
      // Der alte Prototyp korrigiert die Neigung um die Bildschirm-Querachse.
      pitch = -pose.pitch;
    },
    reset() { yaw = null; pitch = 0; },
  };
}