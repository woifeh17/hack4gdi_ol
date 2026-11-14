import {cameraPoseFromEuler, manualCameraPose, normalize360} from '../ar/geometry.js';

export function createOrientation(onStatus) {
  let sample, timer;
  let active = false;
  let generation = 0;
  let yaw = null;
  let pitch = 0;

  function receive(event) {
    if (![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return;
    let absolute = event.absolute || event.type === 'deviceorientationabsolute';
    let alpha = event.alpha;
    // iOS/Safari unterstützt weder deviceorientationabsolute noch ein
    // verlässliches event.absolute. Der absolute Kompasskurs steckt dort
    // im nicht-Standard-Feld webkitCompassHeading (Grad ab Norden, im
    // Uhrzeigersinn). W3C-alpha zählt gegen den Uhrzeigersinn, daher 360 − x.
    if (!absolute && Number.isFinite(event.webkitCompassHeading)) {
      absolute = true;
      alpha = normalize360(360 - event.webkitCompassHeading);
    }
    if (!absolute && sample?.absolute && performance.now() - sample.time < 3000) return;
    const first = !sample || sample.absolute !== absolute;
    sample = {alpha, beta: event.beta, gamma: event.gamma, absolute, time: performance.now()};
    if (first) {
      yaw = null;
      onStatus(absolute ? 'Absolute Orientierung aktiv.' : 'Relative Orientierung aktiv. Bitte Azimut kalibrieren.');
    }
  }

  function rawPose(facing, yawOffset = 0, pitchOffset = 0) {
    if (!sample || performance.now() - sample.time > 4000) return null;
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    return cameraPoseFromEuler(sample.alpha, sample.beta, sample.gamma, angle, yawOffset, pitchOffset, facing);
  }

  return {
    async start() {
      if (active) return;
      const request = ++generation;
      const api = window.DeviceOrientationEvent;
      if (!api) throw new Error('Orientierungssensoren werden hier nicht unterstützt.');
      // iOS verlangt requestPermission() ohne Argument und nur aus einer
      // echten Nutzergeste heraus (siehe startSensors in main.js).
      const permission = api.requestPermission ? await api.requestPermission() : 'granted';
      if (request !== generation) return;
      if (permission !== 'granted') {
        throw new Error('Sensorberechtigung verweigert.');
      }
      active = true;
      window.addEventListener('deviceorientationabsolute', receive);
      window.addEventListener('deviceorientation', receive);
      onStatus('Warte auf Orientierungsdaten …');
      timer = setTimeout(() => { if (!sample) onStatus('Keine Sensordaten. Manuelle Blickrichtung verfügbar.'); }, 2500);
    },
    stop() {
      generation++;
      active = false;
      clearTimeout(timer);
      window.removeEventListener('deviceorientationabsolute', receive);
      window.removeEventListener('deviceorientation', receive);
      sample = null;
      yaw = null;
      pitch = 0;
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
