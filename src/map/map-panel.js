/**
 * Ausklappbare Leaflet-Karte (unten rechts).
 * Setzt voraus, dass Leaflet global als window.L geladen ist.
 */
const DEFAULT_CENTER = [49.9881632, 8.2270956];
const DEFAULT_ZOOM = 9;

/**
 * Pflichtangabe für die Datenquelle (Lizenz CC BY 4.0).
 * Herausgeber und ggf. Hinweis auf Bearbeitung anhand des Angebots prüfen und ergänzen.
 */
const DATA_ATTRIBUTION =
  'Daten: <a href="https://mobilithek.info/offers/922109165921083392" target="_blank" rel="noopener">Mobilithek</a>' +
  ' (Deutsche Bahn AG), <a href="https://creativecommons.org/licenses/by/4.0/deed.de" target="_blank" rel="noopener">CC BY 4.0</a>';


/**
 * @param {HTMLElement} parent  Container, in den die Karte eingehängt wird
 * @param {object} options
 * @param {Array<{id, name, lat, lon}>} [options.pois]
 * @param {[number, number]} [options.center]
 * @param {number} [options.zoom]
 * @param {boolean} [options.defaultOpen]
 * @param {(poi: object) => void} [options.onPoiClick]
 * @param {Array<string>} [options.collectedIds]
 * @returns {{ setPois, setCollected, setOpen, setView, invalidate, destroy }}
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
  root.innerHTML = '<div class="map-panel__map"></div>';
  parent.appendChild(root);

  const mapEl = root.querySelector('.map-panel__map');

  const map = L.map(mapEl, { center, zoom });

  const basemapUrl = options.basemapUrl
    ?? 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  L.tileLayer(basemapUrl, {
    maxZoom: 19,
    maxNativeZoom: 16,
    attribution: options.basemapAttribution ?? '&copy; Esri',
  }).addTo(map);

  // Attribution nimmt nur den Platz rechts neben der Legende ein (Legende ca. 130 px)
  const attributionEl = map.attributionControl.getContainer();
  const fitAttribution = () => {
    attributionEl.style.maxWidth = Math.max(120, map.getSize().x - 130) + 'px';
  };
  fitAttribution();
  map.on('resize', fitAttribution);


  // Eigene Ebene für Linien, liegt unter den POI-Markern
  const railPane = map.createPane('rail');
  railPane.style.zIndex = 350;


  const markerLayer = L.layerGroup().addTo(map);

  function setOpen(open) {
    root.classList.toggle('map-panel--open', open);
    setTimeout(() => map.invalidateSize(), 50);
  }

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
  L.DomEvent.disableClickPropagation(routeBar);

   // Legende als Leaflet-Control unten links. Leaflet ordnet Controls in einer
  // Ecke automatisch untereinander an, dadurch gibt es keine Überlappung mehr.
  const LegendControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-control map-legend');
      container.setAttribute('aria-hidden', 'true');
      container.innerHTML = `
        <span class="map-legend__item"><span class="map-legend__dot map-legend__dot--collected"></span>Im Atlas</span>
        <span class="map-legend__item"><span class="map-legend__dot map-legend__dot--open"></span>Unbekannt</span>
      `;
      L.DomEvent.disableClickPropagation(container);
      return container;
    },
  });

  new LegendControl().addTo(map);

  // Leiste ein- und ausklappen. Der Schalter sitzt in der Leiste selbst,
  // damit er zusammen mit ihr ein- und ausgeblendet wird.
  const barToggle = document.createElement('button');
  barToggle.type = 'button';
  barToggle.className = 'map-route-bar__toggle';
  barToggle.setAttribute('aria-controls', listId);
  // Der Button wird per CSS oben rechts fixiert; im eingeklappten Zustand
  // bestimmt er als einzig sichtbares Element die Größe der Leiste.
  routeBar.insertBefore(barToggle, routeBar.querySelector('.map-route-bar__message'));

  function setBarCollapsed(collapsed) {
    routeBar.classList.toggle('map-route-bar--collapsed', collapsed);
    barToggle.setAttribute('aria-expanded', String(!collapsed));
    barToggle.setAttribute('aria-label', collapsed ? 'Suchleiste ausklappen' : 'Suchleiste einklappen');
    barToggle.textContent = collapsed ? '▼' : '▲';
    // Nach dem Umklappen die Karte neu berechnen
    setTimeout(() => map.invalidateSize(), 100);
  }

  barToggle.addEventListener('click', () => {
    setBarCollapsed(!routeBar.classList.contains('map-route-bar--collapsed'));
  });

  setBarCollapsed(true); // Startzustand: eingeklappt


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
  const collectedIds = new Set(options.collectedIds ?? []);

  function poiStyle(poi) {
    return collectedIds.has(poi.id)
      ? {color: '#0f766e', fillColor: '#2dd4bf', fillOpacity: 0.95, weight: 2}
      : {color: '#1e3a8a', fillColor: '#3b82f6', fillOpacity: 0.9, weight: 2};
  }

  function poiRadiusForZoom(z) {
    return Math.min(
      POI_RADIUS_MAX,
      Math.max(POI_RADIUS_MIN, z - POI_RADIUS_BASE_ZOOM)
    );
  }

  function updatePoiRadius() {
    const radius = poiRadiusForZoom(map.getZoom());
    poiMarkers.forEach(({marker}) => marker.setRadius(radius));
  }

  function setPois(list) {
    markerLayer.clearLayers();
    poiMarkers.length = 0;

    const radius = poiRadiusForZoom(map.getZoom());

    list.forEach((poi) => {
      // textContent statt HTML-String, damit Namen nicht als Markup interpretiert werden
      const label = document.createElement('span');
      const setLabel = () => {
        label.textContent = collectedIds.has(poi.id)
          ? `${poi.name} · im Atlas`
          : poi.name;
      };
      setLabel();

      const marker = L.circleMarker([poi.lat, poi.lon], {
        radius,
        ...poiStyle(poi),
      }).bindTooltip(label);

      if (onPoiClick) marker.on('click', () => onPoiClick(poi));
      marker.addTo(markerLayer);
      poiMarkers.push({marker, poi, setLabel});
    });
  }

  // Atlas-Stand von außen setzen; hebt gesammelte POIs farblich hervor.
  function setCollected(ids) {
    collectedIds.clear();
    for (const id of ids ?? []) collectedIds.add(id);
    for (const entry of poiMarkers) {
      entry.marker.setStyle(poiStyle(entry.poi));
      entry.setLabel();
    }
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
    map.attributionControl.addAttribution(options.dataAttribution ?? DATA_ATTRIBUTION);
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

  // Aktuelle Fahrt muss nicht separat gemerkt werden: "Strecke zeigen" passt
  // den Kartenausschnitt direkt an die gewählte Verbindung an.

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

  // Aktueller Standort als eigene Ebene über den Bahnhöfen
  const locationPane = map.getPane('location') ?? map.createPane('location');
  locationPane.style.zIndex = 680;

  const LOCATE_ZOOM = 13; // Zoomstufe beim Zentrieren auf den Standort
  const locationLayer = L.layerGroup().addTo(map);
  let locationMarker = null;
  let lastLocation = null; // [lat, lon]

  // "Auf Standort zoomen" als Leaflet-Control, direkt unter den +/−-Buttons.
  let locateButton = null;

  function setLocateEnabled(enabled) {
    if (!locateButton) return;
    const label = enabled ? 'Auf Standort zoomen' : 'Standort noch nicht verfügbar';
    locateButton.setAttribute('aria-disabled', String(!enabled));
    locateButton.setAttribute('aria-label', label);
    locateButton.title = label;
  }

  const LocateControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control map-locate-control');
      locateButton = L.DomUtil.create('a', 'map-locate-control__button', container);
      locateButton.href = '#';
      locateButton.setAttribute('role', 'button');
      locateButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/>
          <circle cx="12" cy="12" r="1.75" fill="currentColor"/>
          <path d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`;
      setLocateEnabled(false);

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.on(locateButton, 'click', (event) => {
        L.DomEvent.stop(event);
        if (locateButton.getAttribute('aria-disabled') === 'true') return;
        zoomToLocation();
      });

      return container;
    },
  });

  new LocateControl().addTo(map);

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
    setLocateEnabled(true);
  }

  function clearLocation() {
    lastLocation = null;
    setLocateEnabled(false);
    locationLayer.clearLayers();
    locationMarker = null;
  }

  // Standort kommt vom zentralen Position-Service in main.js, damit es nur
  // eine Geolocation-Anfrage und einen Berechtigungsdialog gibt.
  // Unterstützt sowohl setLocation(lat, lon) als auch setLocation(fix).
  function setLocation(latOrFix, lon) {
    if (latOrFix && typeof latOrFix === 'object') {
      if (latOrFix.source === 'gps') setLocation(latOrFix.lat, latOrFix.lon);
      else clearLocation();
      return;
    }
    if (!Number.isFinite(latOrFix) || !Number.isFinite(lon)) {
      clearLocation();
      return;
    }
    showLocation(latOrFix, lon);
  }

  function zoomToLocation() {
    if (!lastLocation) return;
    setOpen(true);
    map.invalidateSize();
    map.setView(lastLocation, LOCATE_ZOOM);
  }

  function addStations(data) {
    indexStations(data); // nur für die Suche, nicht zeichnen
    map.attributionControl.addAttribution(options.dataAttribution ?? DATA_ATTRIBUTION);
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
    setCollected,
    setOpen,
    addGeoJson,
    addStations,
    setLocation,
    invalidate: () => map.invalidateSize(),
    setView: (lat, lon, z) => map.setView([lat, lon], z ?? map.getZoom()),
    destroy() {
      ro.disconnect();
      map.remove();
      root.remove();
    },

  };

}
