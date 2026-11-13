export function createPoiDetails(dialog, collect, announce) {
  let selected;
  dialog.querySelector('[data-collect]').addEventListener('click', () => {
    try {
      collect(selected.id);
      dialog.close();
      announce(`${selected.name} ist im Atlas.`);
    } catch (error) {
      dialog.querySelector('[data-error]').textContent = error.message;
    }
  });
  return poi => {
    selected = poi;
    dialog.querySelector('h2').textContent = poi.name;
    dialog.querySelector('[data-description]').textContent = poi.description ?? poi.subtitle;
    dialog.querySelector('[data-coordinates]').textContent = `${poi.lat.toFixed(5)}° N · ${poi.lon.toFixed(5)}° E`;
    dialog.querySelector('[data-source]').href = poi.source;
    dialog.querySelector('[data-error]').textContent = '';
    dialog.querySelector('[data-photos]').replaceChildren(...(poi.photos ?? []).map(photo => {
      const figure = document.createElement('figure');
      const image = Object.assign(document.createElement('img'), {src: photo.url, alt: photo.alt});
      const caption = Object.assign(document.createElement('figcaption'), {textContent: photo.credit});
      figure.append(image, caption);
      return figure;
    }));
    dialog.showModal();
  };
}
