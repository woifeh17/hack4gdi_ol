export function renderDashboard(panel, data, pois, openPoi) {
  const km = new Intl.NumberFormat('de-DE', {maximumFractionDigits: 2, minimumFractionDigits: 2});
  panel.querySelector('[data-count]').textContent = data.objects.length;
  panel.querySelector('[data-distance]').textContent = km.format(data.journeys.reduce((sum, trip) => sum + trip.distanceM, 0) / 1000);
  const list = panel.querySelector('[data-objects]');
  const journeys = panel.querySelector('[data-journeys]');
  const item = text => Object.assign(document.createElement('li'), {textContent: text});
  list.replaceChildren(...data.objects.map(entry => {
    const poi = pois.find(candidate => candidate.id === entry.poiId);
    if (!poi) return item(entry.poiId);
    const row = item('');
    const button = Object.assign(document.createElement('button'), {textContent: poi.name});
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
}
