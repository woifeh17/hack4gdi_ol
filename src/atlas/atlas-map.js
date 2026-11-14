import {createJourneyHeatmap} from './journey-heatmap.js';

const MAINZ = [49.9881632, 8.2270956];

function isMapPoint(point) {
  return Number.isFinite(point?.lat) && Math.abs(point.lat) <= 90 &&
    Number.isFinite(point?.lon) && Math.abs(point.lon) <= 180;
}

export function createAtlasMap(L, element) {
  const map = L.map(element, {center: MAINZ, zoom: 12, zoomAnimation: false});
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    maxNativeZoom: 16,
    attribution: '&copy; Esri',
  }).addTo(map);
  const heatmap = createJourneyHeatmap(L, map);
  const markers = L.layerGroup().addTo(map);

  return {
    update(pois, journeys, openPoi) {
      const bounds = L.latLngBounds([]);
      const tracks = journeys.map(journey => {
        const segments = [];
        for (const recorded of journey.segments) {
          let segment = [];
          for (const point of recorded) {
            if (!isMapPoint(point)) {
              segment = [];
              continue;
            }
            if (!segment.length) segments.push(segment);
            const latlng = L.latLng(point.lat, point.lon);
            segment.push(latlng);
            bounds.extend(latlng);
          }
        }
        return segments;
      });

      markers.clearLayers();
      for (const poi of pois.filter(isMapPoint)) {
        const coordinates = [poi.lat, poi.lon];
        const label = document.createElement('span');
        label.textContent = poi.name;
        const marker = L.circleMarker(coordinates, {
          radius: 7,
          color: '#0f766e',
          fillColor: '#2dd4bf',
          fillOpacity: 1,
          weight: 2,
        });
        marker.bindTooltip(label).on('click', () => openPoi(poi)).addTo(markers);
        const path = marker.getElement();
        if (path) {
          path.setAttribute('tabindex', '0');
          path.setAttribute('role', 'button');
          path.setAttribute('aria-label', poi.name);
          path.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openPoi(poi);
          });
        }
        bounds.extend(coordinates);
      }

      map.invalidateSize({pan: false});
      if (bounds.isValid()) map.fitBounds(bounds, {padding: [24, 24], maxZoom: 15, animate: false});
      else map.setView(MAINZ, 12, {animate: false});
      heatmap.setTracks(tracks);
      return bounds.isValid();
    },
  };
}
