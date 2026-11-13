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

  // Karte bei jeder Größenänderung neu berechnen (inkl. Aufklappen)
  const ro = new ResizeObserver(() => map.invalidateSize());
  ro.observe(root);

  function setPois(list) {
    markerLayer.clearLayers();
    list.forEach((poi) => {
      // textContent statt HTML-String, damit Namen nicht als Markup interpretiert werden
      const label = document.createElement('span');
      label.textContent = poi.name;

      const marker = L.circleMarker([poi.lat, poi.lon], {
        radius: 7,
        color: '#1e3a8a',
        fillColor: '#3b82f6',
        fillOpacity: 0.9,
        weight: 2,
      }).bindTooltip(label);

      if (onPoiClick) marker.on('click', () => onPoiClick(poi));
      marker.addTo(markerLayer);
    });
  }

  setPois(pois);
  setOpen(defaultOpen);

  function addGeoJson(data, style = {}) {
    return L.geoJSON(data, {
      style,
      pane: 'rail',
      renderer: L.canvas({ pane: 'rail' }),
    }).addTo(map);
  }

  return {
    setPois,
    setOpen,
    addGeoJson,
    invalidate: () => map.invalidateSize(),
    setView: (lat, lon, z) => map.setView([lat, lon], z ?? map.getZoom()),
    destroy() {
      ro.disconnect();
      map.remove();
      root.remove();
    },
  };

}
