export const mainz = Object.freeze({lat: 49.988163202922046, lon: 8.227095627612766, altitude: null, source: 'fallback'});

// Grobe Fixes (z. B. Zellortung beim ersten iPhone-Fix) werden akzeptiert
// und nur markiert; erst oberhalb dieser Schwelle fällt die App auf den
// Mainz-Referenzpunkt zurück.
const COARSE_ACCURACY_M = 5000;
const FINE_ACCURACY_M = 500;

// iOS: Die Watch-Timeout läuft bereits, während der Freigabedialog offen
// ist. 12 s sind dort zu knapp – der erste Fix kommt oft erst nach der
// Bestätigung, die Watch ist intern aber schon abgelaufen. Großzügiger
// Timeout plus automatischer Neustart der Watch bei Timeout/Abbruch.
const WATCH_TIMEOUT_MS = 30000;
const RETRY_DELAY_MS = 2000;
const MAX_WATCH_RETRIES = 5;
const STALE_FIX_MS = 30000;

export function createPosition(onUpdate) {
  let watch;
  let timer;
  let retryTimer;
  let retries = 0;
  let generation = 0;
  let position = mainz;
  const publish = (next, status) => { position = next; onUpdate(next, status); };

  function armStaleTimer() {
    clearTimeout(timer);
    timer = setTimeout(() => publish(mainz, 'Standortfix veraltet. Mainz-Referenzstandort aktiv.'), STALE_FIX_MS);
  }

  function stop(status = 'Mainz-Referenzstandort aktiv.') {
    generation++;
    if (watch != null) navigator.geolocation.clearWatch(watch);
    watch = null;
    clearTimeout(timer);
    clearTimeout(retryTimer);
    retryTimer = null;
    retries = 0;
    publish(mainz, status);
  }

  function beginWatch() {
    const request = ++generation;
    publish(mainz, 'Warte auf Standortfix …');
    watch = navigator.geolocation.watchPosition(({coords, timestamp}) => {
      if (request !== generation) return;
      clearTimeout(timer);
      const {latitude: lat, longitude: lon, altitude, accuracy} = coords;
      if (![lat, lon, accuracy].every(Number.isFinite) || accuracy > COARSE_ACCURACY_M) {
        // Typischer Safari-Fall, wenn „Präzise Standortortung“ für die App
        // ausgeschaltet ist: es kommen nur sehr grobe Zell-/WLAN-Fixes.
        publish(mainz, `Standort zu ungenau (±${Number.isFinite(accuracy) ? Math.round(accuracy) + ' m' : 'unbekannt'}). iOS: Präzise Standortortung für Safari aktivieren.`);
        return;
      }
      // Einen groben ersten Fix nutzen statt ihn zu verwerfen:
      // Die AR-Szene bleibt sonst am Hardcode-Punkt in Mainz „kleben“.
      retries = 0;
      const coarse = accuracy > FINE_ACCURACY_M;
      publish({lat, lon, altitude, accuracy, timestamp, source: 'gps', coarse},
        coarse ? `Standort grob · ±${Math.round(accuracy)} m` : `Standort aktiv · ±${Math.round(accuracy)} m`);
      armStaleTimer();
    }, error => {
      if (request !== generation) return;
      // Tote Watch freigeben, damit ein Neustart sauber anfangen kann.
      if (watch != null) navigator.geolocation.clearWatch(watch);
      watch = null;
      if (error.code === 1) {
        // Safari fragt nach einer einmaligen Verweigerung (oder einem abge-
        // brochenen Dialog) nie wieder nach. Der Zustand lässt sich nur in
        // den iOS-Einstellungen zurücksetzen – deshalb der klare Hinweis.
        stop('Standortzugriff verweigert. iOS: Einstellungen → Apps → Safari → Standort → „Beim Verwenden der App“ erlauben, dann Seite neu laden.');
        return;
      }
      // Timeout (code 3) oder vorübergehend nicht verfügbar (code 2):
      // Auf iOS passiert das oft, weil der Freigabedialog die erste Anfrage
      // blockiert hat. Watch automatisch neu starten statt aufzugeben.
      if (retries < MAX_WATCH_RETRIES) {
        retries++;
        publish(mainz, 'Standort wird erneut angefragt …');
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (request !== generation || watch != null) return;
          beginWatch();
        }, RETRY_DELAY_MS);
      } else {
        publish(mainz, 'Standort nicht verfügbar. Mainz-Referenzstandort aktiv.');
      }
    }, {enableHighAccuracy: true, timeout: WATCH_TIMEOUT_MS, maximumAge: 3000});
  }

  return {
    get active() { return watch != null || retryTimer != null; },
    get current() { return position; },
    start() {
      if (watch != null) return;
      if (!navigator.geolocation || !window.isSecureContext) throw new Error('Standortzugriff benötigt einen sicheren Kontext.');
      beginWatch();
    },
    stop,
  };
}