export const mainz = Object.freeze({lat: 49.988163202922046, lon: 8.227095627612766, altitude: null, source: 'fallback'});

// Grobe Fixes (z. B. Zellortung beim ersten iPhone-Fix) werden akzeptiert
// und nur markiert; erst oberhalb dieser Schwelle fällt die App auf den
// Mainz-Referenzpunkt zurück.
const COARSE_ACCURACY_M = 5000;
const FINE_ACCURACY_M = 500;

const WATCH_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 2000;
const MAX_WATCH_RETRIES = 5;
const STALE_FIX_MS = 30000;

export function createPosition(onUpdate) {
  let watch;
  let locating = false;
  let timer;
  let retryTimer;
  let retries = 0;
  let generation = 0;
  let position = mainz;
  const publish = (next, status, error) => { position = next; onUpdate(next, status, error); };

  function armStaleTimer() {
    clearTimeout(timer);
    timer = setTimeout(() => publish(mainz, 'Standortfix veraltet. Mainz-Referenzstandort aktiv.'), STALE_FIX_MS);
  }

  function stop(status = 'Mainz-Referenzstandort aktiv.', error) {
    generation++;
    locating = false;
    if (watch != null) navigator.geolocation.clearWatch(watch);
    watch = null;
    clearTimeout(timer);
    clearTimeout(retryTimer);
    retryTimer = null;
    retries = 0;
    publish(mainz, status, error);
  }

  function acceptFix({coords, timestamp}) {
    clearTimeout(timer);
    const {latitude: lat, longitude: lon, altitude, accuracy} = coords;
    if (![lat, lon, accuracy, timestamp].every(Number.isFinite) ||
        Math.abs(lat) > 90 || Math.abs(lon) > 180 || accuracy < 0 || accuracy > COARSE_ACCURACY_M) {
      publish(mainz, 'Standort zu ungenau. Prüfe, ob der Browser den präzisen Standort verwenden darf.');
      return;
    }
    retries = 0;
    const coarse = accuracy > FINE_ACCURACY_M;
    publish({lat, lon, altitude, accuracy, timestamp, source: 'gps', coarse},
      coarse ? `Standort grob · ±${Math.round(accuracy)} m` : `Standort aktiv · ±${Math.round(accuracy)} m`);
    armStaleTimer();
  }

  function denyLocation(error) {
    console.warn('Standortzugriff verweigert:', error.code, error.message);
    const framed = window.top !== window;
    stop(framed
      ? 'Standortzugriff verweigert. Öffne Bahnorama direkt in einem Safari-Tab und tippe erneut auf „GPS aktivieren“.'
      : 'Standortzugriff verweigert. Prüfe in Safari die Einstellungen dieser Website und unter Datenschutz & Sicherheit die Ortungsdienste für Safari-Websites. Tippe danach erneut auf „GPS aktivieren“.', 'denied');
  }

  function beginWatch() {
    const request = ++generation;
    watch = navigator.geolocation.watchPosition(fix => {
      if (request === generation) acceptFix(fix);
    }, error => {
      if (request !== generation) return;
      clearTimeout(timer);
      const failedRequest = ++generation;
      // Tote Watch freigeben, damit ein Neustart sauber anfangen kann.
      if (watch != null) navigator.geolocation.clearWatch(watch);
      watch = null;
      if (error.code === 1) {
        denyLocation(error);
        return;
      }
      if (retries < MAX_WATCH_RETRIES) {
        retries++;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (failedRequest !== generation || watch != null) return;
          beginWatch();
        }, RETRY_DELAY_MS);
        publish(mainz, 'Standort wird erneut angefragt …');
      } else {
        publish(mainz, 'Standort nicht verfügbar. GPS erneut aktivieren.', 'unavailable');
      }
    }, {enableHighAccuracy: true, timeout: WATCH_TIMEOUT_MS, maximumAge: 3000});
    if (position.source !== 'gps') publish(mainz, 'Warte auf Standortfix …');
  }

  function requestInitialFix() {
    const request = ++generation;
    locating = true;
    try {
      navigator.geolocation.getCurrentPosition(fix => {
        if (request !== generation) return;
        acceptFix(fix);
        if (request !== generation) return;
        locating = false;
        beginWatch();
      }, error => {
        if (request !== generation) return;
        locating = false;
        if (error.code === 1) denyLocation(error);
        else beginWatch();
      }, {enableHighAccuracy: false, timeout: WATCH_TIMEOUT_MS, maximumAge: 3000});
    } catch (error) {
      locating = false;
      throw error;
    }
    publish(mainz, 'Warte auf Standortfreigabe oder Standortfix …');
  }

  return {
    get active() { return locating || watch != null || retryTimer != null; },
    get current() { return position; },
    start({userGesture = false} = {}) {
      if (locating || watch != null || retryTimer != null) return;
      if (!navigator.geolocation || !window.isSecureContext) throw new Error('Standortzugriff benötigt einen sicheren Kontext.');
      const policy = globalThis.document?.permissionsPolicy ?? globalThis.document?.featurePolicy;
      if (policy?.allowsFeature?.('geolocation') === false) {
        throw new Error('Standortzugriff ist in dieser Ansicht blockiert. Öffne Bahnorama direkt in einem Browser-Tab.');
      }
      retries = 0;
      if (userGesture) requestInitialFix();
      else beginWatch();
    },
    stop,
  };
}
