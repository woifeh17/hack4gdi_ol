import {createAtlasMap} from './atlas-map.js';

const views = new WeakMap();

function setupDashboard(panel) {
  for (const button of panel.querySelectorAll('.atlas-stats button')) {
    const list = panel.querySelector('#' + button.getAttribute('aria-controls'));
    button.addEventListener('click', () => {
      list.hidden = !list.hidden;
      button.setAttribute('aria-expanded', String(!list.hidden));
    });
  }

  const mapElement = panel.querySelector('[data-atlas-map]');
  const status = panel.querySelector('[data-atlas-map-status]');
  const map = window.L ? createAtlasMap(window.L, mapElement) : null;
  mapElement.hidden = !map;
  panel.querySelector('.atlas-map__legend').hidden = !map;
  const view = {map, status};
  views.set(panel, view);
  return view;
}

export function renderDashboard(panel, data, pois, openPoi) {
  const {map, status} = views.get(panel) ?? setupDashboard(panel);
  const km = new Intl.NumberFormat('de-DE', {maximumFractionDigits: 2, minimumFractionDigits: 2});
  panel.querySelector('[data-count]').textContent = data.objects.length;
  panel.querySelector('[data-distance]').textContent = km.format(data.journeys.reduce((sum, trip) => sum + trip.distanceM, 0) / 1000);

  const poisById = new Map(pois.map(poi => [poi.id, poi]));
  const collectedPois = [];
  const list = panel.querySelector('#atlas-objects');
  const journeys = panel.querySelector('#atlas-journeys');
  const item = text => Object.assign(document.createElement('li'), {textContent: text});
  list.replaceChildren(...data.objects.map(entry => {
    const poi = poisById.get(entry.poiId);
    if (!poi) return item(entry.poiId);
    collectedPois.push(poi);
    const row = item('');
    const button = Object.assign(document.createElement('button'), {type: 'button', textContent: poi.name});
    button.onclick = () => openPoi(poi);
    row.append(button);
    return row;
  }));
  journeys.replaceChildren(...[...data.journeys].reverse().map(trip => {
    const points = trip.segments.reduce((sum, segment) => sum + segment.length, 0);
    return item(`${new Date(trip.startedAt).toLocaleString('de-DE')} · ${km.format(trip.distanceM / 1000)} km · ${points} Standortpunkte`);
  }));
  if (!list.children.length) list.append(item('Noch keine POIs gesammelt.'));
  if (!journeys.children.length) journeys.append(item('Noch keine Fahrten gespeichert.'));

  const hasMapData = map?.update(collectedPois, data.journeys, openPoi);
  status.textContent = map ? 'Noch keine gesammelten POIs oder Fahrten auf der Karte.' : 'Karte derzeit nicht verfügbar.';
  status.hidden = Boolean(hasMapData);
}
