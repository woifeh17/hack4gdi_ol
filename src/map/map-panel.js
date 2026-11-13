/**
 * Ausklappbare Leaflet-Karte (unten rechts).
 * Setzt voraus, dass Leaflet global als window.L geladen ist.
 */
const DEFAULT_CENTER = [49.9881632, 8.2270956];
const DEFAULT_ZOOM = 9;

/**
 * @param {HTMLElement} parent  Container, in den die Karte eingehängt wird
 * @param {object} options
 * @param {Array<{id, name, lat, lon}>} [options.pois]
 * @param {[number, number]} [options.center]
 * @param {number} [options.zoom]
 * @param {boolean} [options.defaultOpen]
 * @param {(poi: object) => void} [options.onPoiClick]
 * @returns {{ setPois, setOpen, setView, invalidate, destroy }}
 */
export function createMapPanel(parent, options = {}) {
  const L = window.L;
  if (!L) throw new Error('Leaflet ist nicht geladen (window.L fehlt).');

  const {
    pois = [],
    center = DEFAULT_CENTER,
    zoom = DEFAULT_ZOOM,
    defaultOpen = false,
    onPoiClick,
    onRouteRequest,
  } = options;


  const root = document.createElement('div');
  root.className = 'map-panel';
  root.innerHTML = `
    <button type="button" class="map-panel__toggle" aria-expanded="false" aria-label="Karte vergrößern">🗺</button>
    <div class="map-panel__map"></div>
  `;
  parent.appendChild(root);

  const toggle = root.querySelector('.map-panel__toggle');
  const mapEl = root.querySelector('.map-panel__map');

  const map = L.map(mapEl, { center, zoom });

  const basemapUrl = options.basemapUrl
    ?? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  L.tileLayer(basemapUrl, {
    maxZoom: 19,
    maxNativeZoom: 16,
    attribution: options.basemapAttribution ?? '&copy; Esri',
  }).addTo(map);

  // Eigene Ebene für Linien, liegt unter den POI-Markern
  const railPane = map.createPane('rail');
  railPane.style.zIndex = 350;



  const markerLayer = L.layerGroup().addTo(map);

  function setOpen(open) {
    root.classList.toggle('map-panel--open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Karte verkleinern' : 'Karte vergrößern');
    toggle.textContent = open ? '✕' : '🗺';
  }

  toggle.addEventListener('click', () => {
    setOpen(!root.classList.contains('map-panel--open'));
  });

    // Start-Ziel-Leiste oben im Panel
  const listId = `map-stations-${Math.random().toString(36).slice(2, 8)}`;
  const routeBar = document.createElement('form');
  routeBar.className = 'map-route-bar';
  routeBar.innerHTML = `
    <input type="text" name="from" list="${listId}" placeholder="Start-Bahnhof" aria-label="Startbahnhof" autocomplete="off">
    <input type="text" name="to" list="${listId}" placeholder="Ziel-Bahnhof" aria-label="Zielbahnhof" autocomplete="off">
    <button type="submit">Strecke zeigen</button>
    <datalist id="${listId}"></datalist>
    <p class="map-route-bar__message" role="status"></p>
  `;
  root.appendChild(routeBar);
  L.DomEvent.disableClickPropagation(routeBar); // Klicks auf die Leiste nicht an die Karte weitergeben

  // Leiste ein- und ausklappen. Der Schalter sitzt in der Leiste selbst,
  // damit er zusammen mit ihr ein- und ausgeblendet wird.
  const barToggle = document.createElement('button');
  barToggle.type = 'button';
  barToggle.className = 'map-route-bar__toggle';
  barToggle.setAttribute('aria-controls', listId);
  routeBar.querySelector('[name="from"]').after(barToggle); // direkt hinter dem Start-Feld


  function setBarCollapsed(collapsed) {
    routeBar.classList.toggle('map-route-bar--collapsed', collapsed);
    barToggle.setAttribute('aria-expanded', String(!collapsed));
    barToggle.setAttribute('aria-label', collapsed ? 'Suchleiste ausklappen' : 'Suchleiste einklappen');
    barToggle.textContent = collapsed ? '▼ Suche' : '▲ Suche';
  }

  barToggle.addEventListener('click', () => {
    setBarCollapsed(!routeBar.classList.contains('map-route-bar--collapsed'));
  });

  setBarCollapsed(false); // Startzustand: ausgeklappt


  const datalist = routeBar.querySelector('datalist');
  const routeMessage = routeBar.querySelector('.map-route-bar__message');
  const stationIndex = new Map(); // Bezeichnung -> GeoJSON-Feature

  function indexStations(data) {
    stationIndex.clear();
    (data.features ?? []).forEach((feature) => {
      const name = stationName(feature.properties);
      if (name && !stationIndex.has(name)) stationIndex.set(name, feature);
    });

    const options = [...stationIndex.keys()]
      .sort((a, b) => a.localeCompare(b, 'de'))
      .map((name) => {
        const option = document.createElement('option');
        option.value = name;
        return option;
      });
    datalist.replaceChildren(...options);
  }

  routeBar.addEventListener('submit', (event) => {
    event.preventDefault();
    const fromName = routeBar.querySelector('[name="from"]').value.trim();
    const toName = routeBar.querySelector('[name="to"]').value.trim();
    const from = stationIndex.get(fromName);
    const to = stationIndex.get(toName);

    if (!from || !to) {
      routeMessage.textContent = 'Bitte Bahnhöfe aus der Vorschlagsliste auswählen.';
      return;
    }
    if (from === to) {
      routeMessage.textContent = 'Start und Ziel sind identisch.';
      return;
    }

    routeMessage.textContent = `Strecke: ${fromName} → ${toName}`;
        currentTrip = { from, to };
    tripButton.disabled = false;
    fitTrip(from, to);

    onRouteRequest?.(from, to); // Übergabe an main.js, dort später das Routing
  });


  // Karte bei jeder Größenänderung neu berechnen (inkl. Aufklappen)
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(root);

   // Radius-Grenzen für POI-Marker in Pixeln
  const POI_RADIUS_MIN = 4;   // bei kleinem Zoom, nie darunter
  const POI_RADIUS_MAX = 8;   // bei großem Zoom, nie darüber
  const POI_RADIUS_BASE_ZOOM = 5; // ab hier wächst der Radius

  const poiMarkers = [];

  function poiRadiusForZoom(z) {
    return Math.min(
      POI_RADIUS_MAX,
      Math.max(POI_RADIUS_MIN, z - POI_RADIUS_BASE_ZOOM)
    );
  }

  function updatePoiRadius() {
    const radius = poiRadiusForZoom(map.getZoom());
    poiMarkers.forEach((marker) => marker.setRadius(radius));
  }

  function setPois(list) {
    markerLayer.clearLayers();
    poiMarkers.length = 0;

    const radius = poiRadiusForZoom(map.getZoom());

    list.forEach((poi) => {
      // textContent statt HTML-String, damit Namen nicht als Markup interpretiert werden
      const label = document.createElement('span');
      label.textContent = poi.name;

      const marker = L.circleMarker([poi.lat, poi.lon], {
        radius,
        color: '#1e3a8a',
        fillColor: '#3b82f6',
        fillOpacity: 0.9,
        weight: 2,
      }).bindTooltip(label);

      if (onPoiClick) marker.on('click', () => onPoiClick(poi));
      marker.addTo(markerLayer);
      poiMarkers.push(marker);
    });
  }

  map.on('zoomend', updatePoiRadius);


  setPois(pois);
  setOpen(defaultOpen);

  const RAIL_WEIGHT_MIN = 1; // Strichstärke in px, nie darunter
  const RAIL_WEIGHT_MAX = 4; // Strichstärke in px, nie darüber
  const RAIL_WEIGHT_BASE_ZOOM = 5; // ab hier wächst die Strichstärke
  const railLayers = [];

  function railWeightForZoom(z) {
    return Math.min(
      RAIL_WEIGHT_MAX,
      Math.max(RAIL_WEIGHT_MIN, z - RAIL_WEIGHT_BASE_ZOOM)
    );
  }

  function updateRailWeight() {
    const weight = railWeightForZoom(map.getZoom());
    railLayers.forEach((layer) => layer.setStyle({ weight }));
  }

  function addGeoJson(data, style = {}) {
    const layer = L.geoJSON(data, {
      style: { ...style, weight: railWeightForZoom(map.getZoom()) },
      pane: 'rail',
      renderer: L.canvas({ pane: 'rail' }),
    }).addTo(map);
    railLayers.push(layer);
    return layer;
  }

  map.on('zoomend', updateRailWeight);

  function stationName(props = {}) {
    // Der Bahnhofsname steht in "Bezeichnung". Die übrigen Kandidaten sind Fallbacks.
    const candidates = [props.Bezeichnung, props.name, props.NAME, props.Name];
    const found = candidates.find(value => typeof value === 'string' && value.trim() !== '');
    return found ? found.trim() : '';
  }

     // Eigene Pane für gewählte Bahnhöfe, liegt über den POI-Markern (overlayPane 400, markerPane 600)
  const selectedPane = map.getPane('selectedStations') ?? map.createPane('selectedStations');
  selectedPane.style.zIndex = 650;

  const selectedStationLayer = L.layerGroup().addTo(map);
  const selectedMarkers = [];

  // Gewählte Bahnhöfe sind bei gleichem Zoom um diesen Wert größer als die POIs
  const SELECTED_RADIUS_OFFSET = 2;

  function selectedRadiusForZoom(z) {
    return poiRadiusForZoom(z) + SELECTED_RADIUS_OFFSET;
  }

  function updateSelectedRadius() {
    const radius = selectedRadiusForZoom(map.getZoom());
    selectedMarkers.forEach((marker) => marker.setRadius(radius));
  }

  function showSelectedStations(features) {
    selectedStationLayer.clearLayers();
    selectedMarkers.length = 0;

    const radius = selectedRadiusForZoom(map.getZoom());

    features.forEach((feature) => {
      const name = stationName(feature.properties);
      if (!name) return;

      const [lon, lat] = feature.geometry.coordinates;
      const label = document.createElement('span');
      label.textContent = name;

      const marker = L.circleMarker([lat, lon], {
        pane: 'selectedStations',
        radius,
        color: '#334155',
        fillColor: '#facc15',
        fillOpacity: 1,
        weight: 2,
      }).bindTooltip(label).addTo(selectedStationLayer);

      selectedMarkers.push(marker);
    });
  }

  map.on('zoomend', updateSelectedRadius);

  // Aktuelle Fahrt merken, damit der Button sie wieder anzeigen kann
  let currentTrip = null;

  // Abstand zum Kartenrand als Anteil der Kartengröße (0.12 = 12 %)
  const FIT_PADDING_RATIO = 0.05;
  const FIT_MAX_ZOOM = 13; // verhindert zu starkes Hineinzoomen bei nahen Bahnhöfen

  function fitTrip(from, to) {
    setOpen(true);       // Panel öffnen, damit der Viewport stimmt
    map.invalidateSize(); // Kartengröße nach dem Öffnen neu bestimmen

    const a = [from.geometry.coordinates[1], from.geometry.coordinates[0]];
    const b = [to.geometry.coordinates[1], to.geometry.coordinates[0]];
    const size = map.getSize();
    const padding = [
      Math.round(size.x * FIT_PADDING_RATIO),
      Math.round(size.y * FIT_PADDING_RATIO),
    ];

    map.fitBounds(L.latLngBounds(a, b), { padding, maxZoom: FIT_MAX_ZOOM });
  }

  // Button "Auf Fahrt zoomen" neben der Leiste, aktiv sobald eine Strecke bestätigt wurde
  const tripButton = document.createElement('button');
  tripButton.type = 'button';
  tripButton.className = 'map-route-bar__trip';
  tripButton.textContent = 'Auf Fahrt zoomen';
  tripButton.disabled = true;
  routeBar.insertBefore(tripButton, routeMessage);

  tripButton.addEventListener('click', () => {
    if (currentTrip) fitTrip(currentTrip.from, currentTrip.to);
  });

    // Aktueller Standort als eigene Ebene über den Bahnhöfen
  const locationPane = map.getPane('location') ?? map.createPane('location');
  locationPane.style.zIndex = 680;

  const LOCATE_ZOOM = 13; // Zoomstufe beim Zentrieren auf den Standort
  const locationLayer = L.layerGroup().addTo(map);
  let locationMarker = null;
  let lastLocation = null; // [lat, lon]
  let watchId = null;

  // Button "Auf Standort zoomen", aktiv sobald ein Standort vorliegt
  const locateButton = document.createElement('button');
  locateButton.type = 'button';
  locateButton.className = 'map-route-bar__locate';
  locateButton.textContent = 'Auf Standort zoomen';
  locateButton.disabled = true;
  routeBar.insertBefore(locateButton, routeMessage);

  function showLocation(lat, lon) {
    lastLocation = [lat, lon];
    if (!locationMarker) {
      locationMarker = L.circleMarker([lat, lon], {
        pane: 'location',
        radius: 7,
        color: '#ffffff',
        weight: 3,
        fillColor: '#dc2626',
        fillOpacity: 1,
      }).bindTooltip('Aktueller Standort').addTo(locationLayer);
    } else {
      locationMarker.setLatLng([lat, lon]);
    }
    locateButton.disabled = false;
  }

  function zoomToLocation() {
    if (!lastLocation) return;
    setOpen(true);
    map.invalidateSize();
    map.setView(lastLocation, LOCATE_ZOOM);
  }

  locateButton.addEventListener('click', zoomToLocation);

  if ('geolocation' in navigator) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => showLocation(pos.coords.latitude, pos.coords.longitude),
      (err) => {
        locateButton.title = `Standort nicht verfügbar: ${err.message}`;
      },
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
  } else {
    locateButton.title = 'Der Browser unterstützt keine Standortabfrage.';
  }

  function addStations(data) {
    indexStations(data); // nur für die Suche, nicht zeichnen
  }

  function updateSelectionFromInputs() {
    const features = ['from', 'to']
      .map((name) => routeBar.querySelector(`[name="${name}"]`).value.trim())
      .map((value) => stationIndex.get(value))
      .filter(Boolean);
    showSelectedStations([...new Set(features)]);
  }

  // 'input' greift beim Tippen, 'change' bei der Auswahl aus der Vorschlagsliste
  routeBar.addEventListener('input', updateSelectionFromInputs);
  routeBar.addEventListener('change', updateSelectionFromInputs);

  return {
    setPois,
    setOpen,
    addGeoJson,
    addStations,
    invalidate: () => map.invalidateSize(),
    setView: (lat, lon, z) => map.setView([lat, lon], z ?? map.getZoom()),
    destroy() {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      ro.disconnect();
      map.remove();
      root.remove();
    },

  };

}
