export const mainz = Object.freeze({lat: 49.988163202922046, lon: 8.227095627612766, altitude: null, source: 'fallback'});

// Grobe Fixes (z. B. Zellortung beim ersten iPhone-Fix) werden akzeptiert
// und nur markiert; erst oberhalb dieser Schwelle fällt die App auf den
// Mainz-Referenzpunkt zurück.
const COARSE_ACCURACY_M = 2000;
const FINE_ACCURACY_M = 500;

export function createPosition(onUpdate) {
  let watch;
  let timer;
  let generation = 0;
  let position = mainz;
  const publish = (next, status) => { position = next; onUpdate(next, status); };

  function stop(status = 'Mainz-Referenzstandort aktiv.') {
    generation++;
    if (watch != null) navigator.geolocation.clearWatch(watch);
    watch = null;
    clearTimeout(timer);
    publish(mainz, status);
  }

  return {
    get active() { return watch != null; },
    get current() { return position; },
    start() {
      if (watch != null) return;
      if (!navigator.geolocation || !window.isSecureContext) throw new Error('Standortzugriff benötigt einen sicheren Kontext.');
      const request = ++generation;
      publish(mainz, 'Warte auf Standortfix …');
      watch = navigator.geolocation.watchPosition(({coords, timestamp}) => {
        if (request !== generation) return;
        clearTimeout(timer);
        const {latitude: lat, longitude: lon, altitude, accuracy} = coords;
        if (![lat, lon, accuracy].every(Number.isFinite) || accuracy > COARSE_ACCURACY_M) {
          publish(mainz, 'Standort zu ungenau. Mainz-Referenzstandort aktiv.');
          return;
        }
        // Einen groben ersten Fix nutzen statt ihn zu verwerfen:
        // Die AR-Szene bleibt sonst am Hardcode-Punkt in Mainz „kleben“.
        const coarse = accuracy > FINE_ACCURACY_M;
        publish({lat, lon, altitude, accuracy, timestamp, source: 'gps', coarse},
          coarse ? `Standort grob · ±${Math.round(accuracy)} m` : `Standort aktiv · ±${Math.round(accuracy)} m`);
        timer = setTimeout(() => publish(mainz, 'Standortfix veraltet. Mainz-Referenzstandort aktiv.'), 30000);
      }, error => {
        if (request !== generation) return;
        clearTimeout(timer);
        if (error.code === 1) stop('Standortzugriff verweigert. Mainz-Referenzstandort aktiv.');
        else publish(mainz, 'Standort vorübergehend nicht verfügbar. Mainz-Referenzstandort aktiv.');
      }, {enableHighAccuracy: true, timeout: 12000, maximumAge: 3000});
    },
    stop,
  };
}