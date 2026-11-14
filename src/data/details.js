export function createPoiDetails(dialog, collect, announce, isCollected = () => false) {
  let selected;
  let canCollect = true;

  const title = dialog.querySelector('#poi-title');
  const subtitle = dialog.querySelector('[data-subtitle]');
  const category = dialog.querySelector('[data-category]');
  const area = dialog.querySelector('[data-area]');
  const atlasStatus = dialog.querySelector('[data-atlas-status]');
  const photosContainer = dialog.querySelector('[data-photos]');
  const descriptionSection = dialog.querySelector('[data-description-section]');
  const description = dialog.querySelector('[data-description]');
  const descriptionCredit = dialog.querySelector('[data-description-credit]');
  const factsSection = dialog.querySelector('[data-facts-section]');
  const factsList = dialog.querySelector('[data-facts]');
  const linksSection = dialog.querySelector('[data-links-section]');
  const linksList = dialog.querySelector('[data-links]');
  const coordinates = dialog.querySelector('[data-coordinates]');
  const sources = dialog.querySelector('[data-sources]');
  const error = dialog.querySelector('[data-error]');
  const collectButton = dialog.querySelector('[data-collect]');

  function externalLink(href, text, className = '') {
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = text;
    if (className) link.className = className;
    return link;
  }

  function hostLabel(href) {
    try {
      return new URL(href).hostname.replace(/^www\./, '');
    } catch {
      return 'externer Link';
    }
  }

  function setChip(element, value) {
    element.textContent = value ?? '';
    element.hidden = !value;
  }

  function renderPhotos(poi) {
    photosContainer.replaceChildren();
    photosContainer.hidden = true;

    (poi.photos ?? []).forEach((photo, index) => {
      if (!photo?.url) return;
      const figure = document.createElement('figure');
      figure.className = 'poi-photo';

      const image = document.createElement('img');
      image.src = photo.url;
      image.alt = photo.alt || poi.name;
      image.loading = index === 0 ? 'eager' : 'lazy';
      image.decoding = 'async';
      image.addEventListener('error', () => {
        figure.remove();
        if (!photosContainer.children.length) photosContainer.hidden = true;
      });

      const caption = document.createElement('figcaption');
      const credit = document.createElement('span');
      credit.textContent = photo.credit || 'Bild: Wikimedia Commons';
      caption.append(credit);

      if (photo.source) {
        caption.append(document.createTextNode(' · '));
        caption.append(externalLink(photo.source, 'Bildquelle ↗', 'poi-photo__source'));
      }

      figure.append(image, caption);
      photosContainer.append(figure);
    });

    photosContainer.hidden = photosContainer.children.length === 0;
  }

  function renderDescription(poi) {
    const text = poi.description?.trim();
    description.textContent = text ?? '';
    descriptionSection.hidden = !text;

    const credit = poi.descriptionCredit?.trim();
    descriptionCredit.replaceChildren();
    if (credit) {
      descriptionCredit.append(document.createTextNode(credit));
      if (poi.descriptionSource) {
        descriptionCredit.append(document.createTextNode(' · '));
        descriptionCredit.append(externalLink(poi.descriptionSource, 'Quelle ↗'));
      }
    }
    descriptionCredit.hidden = !credit;
  }

  function renderFacts(poi) {
    const facts = (poi.facts ?? []).filter(fact => fact?.label && fact?.value);
    factsList.replaceChildren(...facts.map(fact => {
      const item = document.createElement('div');
      item.className = 'poi-fact';
      const label = document.createElement('dt');
      label.textContent = fact.label;
      const value = document.createElement('dd');
      value.textContent = fact.value;
      if (fact.source) value.title = `Quelle: ${fact.source}`;
      item.append(label, value);
      return item;
    }));
    factsSection.hidden = facts.length === 0;
  }

  function renderLinks(poi) {
    const links = (poi.links ?? []).filter(link => link?.label && link?.href);
    if (!links.length && poi.source) links.push({label: 'Quelle', href: poi.source});

    linksList.replaceChildren(...links.map(link => {
      const anchor = externalLink(link.href, '', 'poi-link');
      const label = document.createElement('span');
      label.className = 'poi-link__label';
      label.textContent = link.label;
      const hint = document.createElement('span');
      hint.className = 'poi-link__hint';
      hint.textContent = hostLabel(link.href);
      anchor.append(label, hint);
      return anchor;
    }));
    linksSection.hidden = links.length === 0;
  }

  function renderSources(poi) {
    const entries = (poi.sources ?? []).filter(source => source?.label);
    sources.replaceChildren();
    if (entries.length) {
      sources.append(document.createTextNode('Daten: '));
      entries.forEach((source, index) => {
        if (index) sources.append(document.createTextNode(' · '));
        if (source.url) {
          sources.append(externalLink(source.url, source.label));
        } else {
          sources.append(document.createTextNode(source.label));
        }
        if (source.license) {
          sources.append(document.createTextNode(` (${source.license})`));
        }
      });
    }
    sources.hidden = entries.length === 0;
  }

  collectButton.addEventListener('click', () => {
    if (!canCollect || !selected) return;
    try {
      collect(selected.id);
      collectButton.hidden = true;
      dialog.close();
      announce(`${selected.name} ist im Atlas.`);
    } catch (error) {
      error.textContent = error.message;
      error.hidden = false;
    }
  });

  // collectable ist standardmäßig true, damit bestehende Aufrufe unverändert funktionieren
  return (poi, { collectable = true } = {}) => {
    selected = poi;
    canCollect = collectable;

    title.textContent = poi.name;
    setChip(category, poi.category);
    setChip(area, poi.area);
    subtitle.textContent = poi.subtitle ?? '';
    subtitle.hidden = !poi.subtitle;

    let collected = false;
    try {
      collected = Boolean(isCollected(poi.id));
    } catch {
      collected = false;
    }
    atlasStatus.hidden = !collected;
    collectButton.hidden = !collectable || collected;

    renderPhotos(poi);
    renderDescription(poi);
    renderFacts(poi);
    renderLinks(poi);
    renderSources(poi);

    const hasCoordinates = Number.isFinite(poi.lat) && Number.isFinite(poi.lon);
    coordinates.textContent = hasCoordinates
      ? `${poi.lat.toFixed(5)}° N · ${poi.lon.toFixed(5)}° E`
      : '';
    coordinates.hidden = !hasCoordinates;

    error.textContent = '';
    error.hidden = true;
    dialog.scrollTop = 0;
    dialog.showModal();
  };
}
