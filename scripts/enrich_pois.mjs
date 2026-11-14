// Erzeugt src/data/poiEnrichment.js aus OSM, Wikidata, Wikipedia und Commons.
// Die Datei liegt bewusst neben dem kuratierten POI-Katalog und wird zur
// Laufzeit importiert, statt die externen APIs im Browser abzufragen.
//
// Verwendung:
//   node scripts/enrich_pois.mjs
//
// Benötigt Node 18+ (globales fetch). Es werden keine npm-Pakete benötigt.

import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {mainzTestPois} from '../src/data/mainzTestPois.js';

const USER_AGENT = 'WindowLens-POI-Enrichment/1.0 (local hackathon project)';
const OUTPUT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/data/poiEnrichment.js',
);
const WIKIPEDIA_LICENSE = 'CC BY-SA 4.0';
const COMMONS_THUMB_WIDTH = 1200;
const MAX_DESCRIPTION_LENGTH = 800;
const MAX_FACTS = 10;
const MAX_PHOTOS = 3;

const SOURCE_INFO = {
  openstreetmap: {
    label: 'OpenStreetMap',
    license: 'ODbL 1.0',
    url: 'https://www.openstreetmap.org/copyright',
  },
  wikidata: {
    label: 'Wikidata',
    license: 'CC0 1.0',
    url: 'https://www.wikidata.org/wiki/Wikidata:Licensing',
  },
  wikipedia: {
    label: 'Wikipedia',
    license: WIKIPEDIA_LICENSE,
    url: 'https://de.wikipedia.org/wiki/Wikipedia:Lizenzbestimmungen',
  },
  commons: {
    label: 'Wikimedia Commons',
    license: 'je Bild',
    url: 'https://commons.wikimedia.org/wiki/Commons:Lizenzen',
  },
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function cleanText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(text, maxLength = MAX_DESCRIPTION_LENGTH) {
  const clean = cleanText(text);
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const sentenceEnd = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
  );
  if (sentenceEnd > maxLength * 0.5) return cut.slice(0, sentenceEnd + 1);
  return `${cut.trimEnd()}…`;
}

function normalizeUrl(value) {
  if (!value) return '';
  let text = String(value).trim();
  if (!text) return '';
  if (text.startsWith('//')) text = `https:${text}`;
  if (!/^https?:\/\//i.test(text)) {
    if (!/^[\w.-]+\.[a-z]{2,}(?:\/|$)/i.test(text)) return '';
    text = `https://${text}`;
  }
  try {
    return new URL(text).href;
  } catch {
    return '';
  }
}

function distanceMeters(aLat, aLon, bLat, bLon) {
  const toRad = value => value * Math.PI / 180;
  const earthRadius = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

async function fetchJson(url, {retries = 3, timeout = 45000} = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        error.retryAfter = Number(response.headers.get('retry-after')) || 0;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const rateLimitWait = error.status === 429
          ? Math.max(2500, error.retryAfter * 1000, 1500 * 2 ** attempt)
          : 600 * (attempt + 1);
        await sleep(rateLimitWait);
      }
    }
  }
  throw lastError;
}

function apiUrl(base, params) {
  return `${base}?${new URLSearchParams(params).toString()}`;
}

// ---------------------------------------------------------------------------
// OSM
// ---------------------------------------------------------------------------

function osmElementType(ref) {
  const type = String(ref).split('/')[0];
  if (type === 'relation') return 'rel';
  return type;
}

function osmRefFromPoi(poi) {
  if (!poi.osmRef) return null;
  const match = /^(node|way|relation)\/(\d+)$/.exec(poi.osmRef);
  return match ? {type: match[1], id: match[2]} : null;
}

function osmUrl(poi) {
  return poi.osmRef ? `https://www.openstreetmap.org/${poi.osmRef}` : '';
}

async function fetchOsmTags(pois) {
  const refs = pois.map(osmRefFromPoi).filter(Boolean);
  if (!refs.length) return new Map();

  const query = `[out:json][timeout:90];(${refs
    .map(ref => `${osmElementType(`${ref.type}/${ref.id}`)}(id:${ref.id});`)
    .join('')});out tags;`;
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  for (const endpoint of endpoints) {
    try {
      const data = await fetchJson(`${endpoint}?data=${encodeURIComponent(query)}`, {
        timeout: 120000,
      });
      return new Map((data.elements ?? []).map(element => [
        `${element.type}/${element.id}`,
        element.tags ?? {},
      ]));
    } catch (error) {
      console.warn(`Overpass nicht erreichbar (${endpoint}): ${error.message}`);
    }
  }

  console.warn('Overpass fehlgeschlagen, versuche OSM-API einzeln …');
  const result = new Map();
  for (const ref of refs) {
    try {
      const data = await fetchJson(
        `https://api.openstreetmap.org/api/0.6/${ref.type}/${ref.id}.json`,
        {timeout: 20000},
      );
      const element = data.elements?.[0];
      if (element) result.set(`${element.type}/${element.id}`, element.tags ?? {});
      await sleep(120);
    } catch (error) {
      console.warn(`OSM ${ref.type}/${ref.id}: ${error.message}`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Wikipedia
// ---------------------------------------------------------------------------

function parseWikipediaTag(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const match = /^([a-z]{2,3}):(.+)$/i.exec(text);
  if (match) return {lang: match[1].toLowerCase(), title: match[2].trim()};
  return {lang: 'de', title: text};
}

function wikipediaFromSource(source) {
  if (!source) return null;
  try {
    const url = new URL(source);
    if (url.hostname !== 'de.wikipedia.org' && url.hostname !== 'en.wikipedia.org') return null;
    const title = decodeURIComponent(url.pathname.replace(/^\/wiki\//, '')).replace(/_/g, ' ');
    if (!title || /^Special:/i.test(title)) return null;
    return {lang: url.hostname.slice(0, 2), title};
  } catch {
    return null;
  }
}

function wikipediaUrl(ref, pageTitle) {
  if (!ref) return '';
  return `https://${ref.lang}.wikipedia.org/wiki/${encodeURIComponent((pageTitle ?? ref.title).replace(/ /g, '_'))}`;
}

async function fetchWikipediaPages(refs) {
  const groups = new Map();
  for (const ref of refs) {
    if (!ref?.title) continue;
    const lang = ref.lang === 'en' ? 'en' : 'de';
    if (!groups.has(lang)) groups.set(lang, new Map());
    groups.get(lang).set(ref.title, ref.title);
  }

  const pages = new Map();
  for (const [lang, titleMap] of groups) {
    const titles = [...titleMap.values()];
    for (let offset = 0; offset < titles.length; offset += 20) {
      const batch = titles.slice(offset, offset + 20);
      const data = await fetchJson(apiUrl(`https://${lang}.wikipedia.org/w/api.php`, {
        action: 'query',
        titles: batch.join('|'),
        prop: 'extracts|pageimages|pageprops',
        exintro: '1',
        explaintext: '1',
        exlimit: '20',
        piprop: 'name|original',
        redirects: '1',
        format: 'json',
        formatversion: '2',
      }));
      const normalized = new Map((data.query?.normalized ?? []).map(entry => [entry.from, entry.to]));
      const redirects = new Map((data.query?.redirects ?? []).map(entry => [entry.from, entry.to]));
      const byTitle = new Map((data.query?.pages ?? []).map(page => [page.title, page]));

      for (const title of batch) {
        let resolved = normalized.get(title) ?? title;
        resolved = redirects.get(resolved) ?? resolved;
        const page = byTitle.get(resolved);
        if (!page || page.missing) continue;
        pages.set(`${lang}:${title}`, page);
        pages.set(`${lang}:${page.title}`, page);
      }
      await sleep(160);
    }
  }
  return pages;
}

function getWikipediaPage(pages, ref) {
  if (!ref) return null;
  const lang = ref.lang === 'en' ? 'en' : 'de';
  return pages.get(`${lang}:${ref.title}`) ?? null;
}

// ---------------------------------------------------------------------------
// Wikidata
// ---------------------------------------------------------------------------

function bestClaims(entity, property) {
  const claims = entity?.claims?.[property] ?? [];
  const active = claims.filter(claim => claim.rank !== 'deprecated');
  const preferred = active.filter(claim => claim.rank === 'preferred');
  return preferred.length ? preferred : active;
}

function claimValue(entity, property) {
  return bestClaims(entity, property)[0]?.mainsnak?.datavalue?.value;
}

function claimString(entity, property) {
  const value = claimValue(entity, property);
  return typeof value === 'string' ? value : '';
}

function claimEntityIds(entity, property) {
  return bestClaims(entity, property)
    .map(claim => claim.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);
}

function claimTime(entity, property) {
  const value = claimValue(entity, property);
  return typeof value?.time === 'string' ? value.time : '';
}

function claimQuantity(entity, property) {
  return claimValue(entity, property) ?? null;
}

function coordinateFromEntity(entity) {
  const value = claimValue(entity, 'P625');
  if (typeof value?.latitude !== 'number' || typeof value?.longitude !== 'number') return null;
  return {lat: value.latitude, lon: value.longitude};
}

function entityLabel(entity) {
  return entity?.labels?.de?.value ?? entity?.labels?.en?.value ?? '';
}

function entityDescription(entity) {
  return entity?.descriptions?.de?.value ?? '';
}

async function fetchWikidata(qids) {
  const ids = [...new Set(qids.filter(id => /^Q\d+$/.test(id)))];
  const entities = {};
  for (let offset = 0; offset < ids.length; offset += 50) {
    const batch = ids.slice(offset, offset + 50);
    const data = await fetchJson(apiUrl('https://www.wikidata.org/w/api.php', {
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'claims|sitelinks|descriptions|labels',
      languages: 'de|en',
      format: 'json',
    }));
    Object.assign(entities, data.entities ?? {});
    await sleep(160);
  }
  return entities;
}

async function fetchWikidataLabels(qids) {
  const ids = [...new Set(qids.filter(id => /^Q\d+$/.test(id)))];
  const labels = new Map();
  for (let offset = 0; offset < ids.length; offset += 50) {
    const batch = ids.slice(offset, offset + 50);
    const data = await fetchJson(apiUrl('https://www.wikidata.org/w/api.php', {
      action: 'wbgetentities',
      ids: batch.join('|'),
      props: 'labels',
      languages: 'de|en',
      format: 'json',
    }));
    for (const [id, entity] of Object.entries(data.entities ?? {})) {
      labels.set(id, entityLabel(entity) || id);
    }
    await sleep(160);
  }
  return labels;
}

function searchTermsForPoi(poi) {
  const terms = [poi.name];
  const simplified = poi.name
    .replace(/\b[A-ZÄÖÜ]{2,5}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (simplified && simplified !== poi.name) {
    terms.push(`${simplified} Mainz`, simplified);
  }
  try {
    const url = new URL(poi.source);
    const slug = url.pathname.split('/').filter(Boolean).pop() ?? '';
    const fromSlug = decodeURIComponent(slug)
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, character => character.toUpperCase());
    if (fromSlug) terms.push(`${fromSlug} Mainz`, fromSlug);
  } catch {
    // Keine verwertbare Quell-URL.
  }
  return [...new Set(terms)].slice(0, 3);
}

async function searchWikidataForPoi(poi) {
  for (const term of searchTermsForPoi(poi)) {
    const data = await fetchJson(apiUrl('https://www.wikidata.org/w/api.php', {
      action: 'wbsearchentities',
      search: term,
      language: 'de',
      uselang: 'de',
      type: 'item',
      limit: '6',
      format: 'json',
    }));
    const ids = (data.search ?? []).map(hit => hit.id).filter(id => /^Q\d+$/.test(id));
    if (!ids.length) {
      await sleep(800);
      continue;
    }
    const entities = await fetchWikidata(ids);
    for (const id of ids) {
      const coordinate = coordinateFromEntity(entities[id]);
      if (!coordinate) continue;
      if (distanceMeters(poi.lat, poi.lon, coordinate.lat, coordinate.lon) <= 1200) {
        return id;
      }
    }
    await sleep(800);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Commons
// ---------------------------------------------------------------------------

function normalizeFileTitle(value) {
  if (!value) return '';
  return String(value)
    .replace(/^File:/i, '')
    .replace(/^Datei:/i, '')
    .replace(/_/g, ' ')
    .trim();
}

function fileKey(value) {
  return normalizeFileTitle(value).toLocaleLowerCase('de');
}

const NON_PHOTO_FILE = /(^|[\s_.-])(logo|wappen|coat[ _-]?of[ _-]?arms|icon|symbol|piktogramm|map|karte|plan|grundriss|diagram|chart|sign|schild|tafel|banner|flagge)([\s_.-]|$)/i;

function isUsefulPhotoTitle(title) {
  const name = normalizeFileTitle(title);
  return Boolean(name) && !NON_PHOTO_FILE.test(name);
}

function cleanRemoteUrl(value) {
  const url = normalizeUrl(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.startsWith('utm_')) parsed.searchParams.delete(key);
    }
    return parsed.href;
  } catch {
    return url;
  }
}

function commonsFileTitle(value) {
  if (!value) return '';
  const text = String(value).trim();
  if (!text) return '';
  if (/^(File|Datei):/i.test(text)) return normalizeFileTitle(text);
  if (/^[^/]+\.(?:jpe?g|png|gif|webp|svg)$/i.test(text)) return text;
  try {
    const url = new URL(text.startsWith('//') ? `https:${text}` : text);
    const decodedPath = decodeURIComponent(url.pathname);
    if (/(^|\.)commons\.wikimedia\.org$/i.test(url.hostname)) {
      const match = /\/wiki\/(?:File|Datei):(.+)$/i.exec(decodedPath);
      if (match) return normalizeFileTitle(match[1].replace(/_/g, ' '));
    }
    if (/(^|\.)upload\.wikimedia\.org$/i.test(url.hostname)) {
      const name = decodedPath.split('/').pop() ?? '';
      if (/\.(?:jpe?g|png|gif|webp|svg)$/i.test(name)) {
        return normalizeFileTitle(name.replace(/^\d+px-/, ''));
      }
    }
  } catch {
    // Kein URL: unten als reinen Dateinamen behandeln.
  }
  return '';
}

async function fetchCommonsMetadata(fileTitles) {
  const unique = new Map();
  for (const title of fileTitles) {
    const normalized = normalizeFileTitle(title);
    if (normalized) unique.set(fileKey(normalized), normalized);
  }

  const titles = [...unique.values()];
  const result = new Map();
  for (let offset = 0; offset < titles.length; offset += 40) {
    const batch = titles.slice(offset, offset + 40);
    const data = await fetchJson(apiUrl('https://commons.wikimedia.org/w/api.php', {
      action: 'query',
      titles: batch.map(title => `File:${title}`).join('|'),
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: String(COMMONS_THUMB_WIDTH),
      format: 'json',
      formatversion: '2',
    }));

    const normalized = new Map(
      (data.query?.normalized ?? []).map(entry => [fileKey(entry.from), entry.to]),
    );

    for (const page of data.query?.pages ?? []) {
      if (page.missing || !page.imageinfo?.[0]) continue;
      const info = page.imageinfo[0];
      if (!/^image\/(?:jpeg|png|webp|gif)$/i.test(info.mime ?? '')) continue;
      const meta = info.extmetadata ?? {};
      const license = cleanText(
        meta.LicenseShortName?.value
        || meta.UsageTerms?.value
        || '',
      );
      if (!license || /non[- ]free|fair use|all rights reserved/i.test(license)) continue;
      const artist = cleanText(meta.Artist?.value)
        || cleanText(meta.Credit?.value)
        || 'Wikimedia Commons';
      const licenseUrl = normalizeUrl(meta.LicenseUrl?.value);
      const source = normalizeUrl(info.descriptionurl);
      const url = cleanRemoteUrl(info.thumburl || info.url);
      if (!source || !url) continue;
      const restrictions = cleanText(meta.Restrictions?.value);
      // Persönlichkeitsrechte sind keine Lizenzfrage, aber für eine
      // unkomplizierte Weiterverwendung lieber konservativ ausfiltern.
      if (/personality|trademark|insignia/i.test(restrictions)) continue;

      const metadata = {
        url,
        alt: '', // wird pro POI gesetzt
        credit: `Foto: ${artist} · ${license}`,
        license,
        licenseUrl,
        source,
        fileName: page.title,
        width: info.thumbwidth ?? info.width,
        height: info.thumbheight ?? info.height,
      };
      if (restrictions) metadata.restrictions = restrictions;

      result.set(fileKey(page.title), metadata);
      const requested = normalized.get(fileKey(page.title));
      if (requested) result.set(fileKey(requested), metadata);
    }
    await sleep(180);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Fakten und Links
// ---------------------------------------------------------------------------

function formatDate(value) {
  if (!value) return '';
  const match = /^[+-]?(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return String(value);
  const [, year, month, day] = match;
  if (month === '00') return year;
  if (day === '00') return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? '');
  return new Intl.NumberFormat('de-DE', {maximumFractionDigits: 2}).format(number);
}

function formatQuantity(value, suffix = '') {
  if (value == null) return '';
  const amount = Number(value.amount);
  if (!Number.isFinite(amount)) return '';
  return `${formatNumber(amount)}${suffix}`;
}

function formatOsmQuantity(value, suffix = '') {
  const text = cleanText(value);
  if (!text) return '';
  const normalized = text.replace(',', '.');
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return `${formatNumber(normalized)}${suffix}`;
  return text;
}

function pushFact(facts, label, value, source) {
  const text = cleanText(value);
  if (!text || facts.some(fact => fact.label === label)) return;
  facts.push({label, value: text, source});
}

function addressFromTags(tags) {
  const street = tags['addr:street'] || tags['addr:place'];
  const number = tags['addr:housenumber'];
  const postcode = tags['addr:postcode'];
  const city = tags['addr:city'];
  const line = [street, number].filter(Boolean).join(' ');
  const locality = [postcode, city].filter(Boolean).join(' ');
  return [line, locality].filter(Boolean).join(', ');
}

function buildFacts(state, labels) {
  const facts = [];
  const {tags, entity} = state;

  pushFact(facts, 'Adresse', addressFromTags(tags), 'OpenStreetMap');

  const typeIds = claimEntityIds(entity, 'P31');
  const genericTypes = /^(Bauwerk|Gebäude|Struktur|geographisches Objekt|menschliche Siedlung|Organisation)$/i;
  const type = typeIds
    .map(id => labels.get(id))
    .filter(label => label && !genericTypes.test(label))
    .slice(0, 2)
    .join(', ');
  pushFact(facts, 'Typ', type, 'Wikidata');

  const operatorTags = tags.operator || tags['operator:de'];
  const operatorIds = claimEntityIds(entity, 'P127');
  const operator = operatorTags || operatorIds.map(id => labels.get(id)).filter(Boolean).join(', ');
  pushFact(facts, 'Betreiber', operator, operatorTags ? 'OpenStreetMap' : 'Wikidata');

  const osmStart = tags.start_date;
  const opening = claimTime(entity, 'P1619');
  const inception = claimTime(entity, 'P571');
  if (osmStart) pushFact(facts, 'Eröffnung', formatDate(osmStart), 'OpenStreetMap');
  else if (opening) pushFact(facts, 'Eröffnung', formatDate(opening), 'Wikidata');
  else if (inception) pushFact(facts, 'Baujahr', formatDate(inception), 'Wikidata');

  const osmHeight = tags.height;
  const wikidataHeight = claimQuantity(entity, 'P2048');
  if (osmHeight) pushFact(facts, 'Höhe', formatOsmQuantity(osmHeight, ' m'), 'OpenStreetMap');
  else if (wikidataHeight) pushFact(facts, 'Höhe', formatQuantity(wikidataHeight, ' m'), 'Wikidata');

  const osmLevels = tags['building:levels'];
  if (osmLevels) pushFact(facts, 'Geschosse', formatOsmQuantity(osmLevels), 'OpenStreetMap');

  const osmCapacity = tags.capacity;
  const wikidataCapacity = claimQuantity(entity, 'P1083');
  if (osmCapacity) pushFact(facts, 'Kapazität', formatOsmQuantity(osmCapacity), 'OpenStreetMap');
  else if (wikidataCapacity) pushFact(facts, 'Kapazität', formatQuantity(wikidataCapacity), 'Wikidata');

  const architectTags = tags.architect;
  const architectIds = claimEntityIds(entity, 'P84');
  const architect = architectTags || architectIds.map(id => labels.get(id)).filter(Boolean).join(', ');
  pushFact(facts, 'Architekt', architect, architectTags ? 'OpenStreetMap' : 'Wikidata');

  const heritageTags = tags.heritage && tags.heritage !== 'yes' ? tags.heritage : '';
  const heritageIds = claimEntityIds(entity, 'P1435');
  const heritage = heritageTags || heritageIds.map(id => labels.get(id)).filter(Boolean).join(', ');
  pushFact(facts, 'Denkmalstatus', heritage, heritageTags ? 'OpenStreetMap' : 'Wikidata');

  if (tags.opening_hours) pushFact(facts, 'Öffnungszeiten', tags.opening_hours, 'OpenStreetMap');

  return facts.slice(0, MAX_FACTS);
}

function buildLinks(state) {
  const links = [];
  const seen = new Set();
  const add = (label, href) => {
    const url = normalizeUrl(href);
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({label, href: url});
  };

  const website = state.tags.website
    || state.tags['contact:website']
    || claimString(state.entity, 'P856');
  add('Website', website);

  if (state.wikiPage) {
    add('Wikipedia', wikipediaUrl(state.wikiRef, state.wikiPage.title));
  } else if (state.wikiRef) {
    add('Wikipedia', wikipediaUrl(state.wikiRef));
  }

  if (state.qid) add('Wikidata', `https://www.wikidata.org/wiki/${state.qid}`);

  const commonsCategory = claimString(state.entity, 'P373');
  if (commonsCategory) {
    add('Commons', `https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(commonsCategory.replace(/ /g, '_'))}`);
  }

  add('OpenStreetMap', osmUrl(state.poi));
  add('Quelle', state.poi.source);

  return links;
}

function photoCandidates(state) {
  const candidates = [];
  const add = value => {
    const title = commonsFileTitle(value);
    if (!title || !isUsefulPhotoTitle(title)) return;
    const key = fileKey(title);
    if (!key || candidates.some(candidate => fileKey(candidate) === key)) return;
    candidates.push(title);
  };

  // OSM-Bildtags sind direkt am Objekt gepflegt. Danach folgen Wikidata und
  // das Wikipedia-Leadbild als Fallback für POIs ohne OSM-Bild.
  add(state.tags.image);
  if (/^(File|Datei):/i.test(state.tags.wikimedia_commons ?? '')) {
    add(state.tags.wikimedia_commons);
  }
  add(claimString(state.entity, 'P18'));
  // Das Wikipedia-Leadbild ist nur ein Fallback: Es ist nicht immer ein Bild
  // des POIs selbst (z. B. kann es einen nahen Knotenpunkt zeigen).
  const pageImage = commonsFileTitle(state.wikiPage?.pageimage);
  if (pageImage && isUsefulPhotoTitle(pageImage)) add(pageImage);
  return candidates.slice(0, MAX_PHOTOS);
}

function buildPhotos(state, commonsMetadata) {
  const photos = [];
  const pageImageKey = fileKey(state.wikiPage?.pageimage ?? '');
  for (const title of state.photoFiles ?? []) {
    const key = fileKey(title);
    const metadata = commonsMetadata.get(key);
    if (!metadata) continue;
    // Wenn OSM/Wikidata bereits ein brauchbares Bild liefern, ist das
    // Wikipedia-Leadbild nicht nötig und kann sogar ein falsches Motiv zeigen.
    if (photos.length && key === pageImageKey) continue;
    photos.push({
      ...metadata,
      alt: state.poi.name,
    });
  }
  return photos;
}

// ---------------------------------------------------------------------------
// Hauptlauf
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Lade ${mainzTestPois.length} POIs …`);

  const osmTags = await fetchOsmTags(mainzTestPois);
  console.log(`OSM: ${osmTags.size} Objekte gefunden`);

  const states = mainzTestPois.map(poi => {
    const tags = osmTags.get(poi.osmRef) ?? {};
    const wikiRef = parseWikipediaTag(tags.wikipedia) ?? wikipediaFromSource(poi.source);
    const qidFromOsm = /^Q\d+$/.test(tags.wikidata ?? '') ? tags.wikidata : '';
    return {
      poi,
      tags,
      wikiRef,
      wikiPage: null,
      qid: qidFromOsm,
      entity: null,
      photoFiles: [],
    };
  });

  const firstWikiRefs = states.map(state => state.wikiRef).filter(Boolean);
  const firstWikiPages = await fetchWikipediaPages(firstWikiRefs);
  for (const state of states) {
    if (!state.wikiRef) continue;
    state.wikiPage = getWikipediaPage(firstWikiPages, state.wikiRef);
    const pageQid = state.wikiPage?.pageprops?.wikibase_item;
    if (!state.qid && /^Q\d+$/.test(pageQid ?? '')) state.qid = pageQid;
  }
  console.log(`Wikipedia: ${states.filter(state => state.wikiPage).length} Artikel geladen`);

  // Die Namenssuche ist nur für POIs ohne OSM-/Wikipedia-Anker gedacht.
  // Sonst drohen falsche Treffer und unnötige Wikidata-Rate-Limits.
  for (const state of states) {
    if (state.poi.osmRef || state.qid || state.wikiRef) continue;
    try {
      const qid = await searchWikidataForPoi(state.poi);
      if (qid) state.qid = qid;
      await sleep(400);
    } catch (error) {
      console.warn(`Wikidata-Suche für ${state.poi.id}: ${error.message}`);
    }
  }

  const wikidata = await fetchWikidata(states.map(state => state.qid));
  for (const state of states) {
    if (!state.qid) continue;
    state.entity = wikidata[state.qid] ?? null;
    if (state.entity && !state.wikiRef) {
      const sitelink = state.entity.sitelinks?.dewiki ?? state.entity.sitelinks?.enwiki;
      if (sitelink?.title) {
        state.wikiRef = {
          lang: state.entity.sitelinks?.dewiki ? 'de' : 'en',
          title: sitelink.title,
        };
      }
    }
  }

  const secondWikiRefs = states
    .filter(state => state.wikiRef && !state.wikiPage)
    .map(state => state.wikiRef);
  if (secondWikiRefs.length) {
    const secondWikiPages = await fetchWikipediaPages(secondWikiRefs);
    for (const state of states) {
      if (!state.wikiRef || state.wikiPage) continue;
      state.wikiPage = getWikipediaPage(secondWikiPages, state.wikiRef);
    }
  }

  // Falls erst der Wikipedia-Artikel eine Wikidata-ID geliefert hat, die noch
  // nicht abgefragt wurde, holen wir sie einmal nach.
  const missingQids = states
    .filter(state => state.wikiPage?.pageprops?.wikibase_item && !state.entity)
    .map(state => state.wikiPage.pageprops.wikibase_item);
  if (missingQids.length) {
    const extraWikidata = await fetchWikidata(missingQids);
    for (const state of states) {
      const qid = state.wikiPage?.pageprops?.wikibase_item;
      if (!state.entity && qid && extraWikidata[qid]) {
        state.qid = qid;
        state.entity = extraWikidata[qid];
      }
    }
  }

  const labelIds = [];
  for (const state of states) {
    for (const property of ['P31', 'P127', 'P84', 'P1435']) {
      labelIds.push(...claimEntityIds(state.entity, property));
    }
  }
  const labels = await fetchWikidataLabels(labelIds);

  const allPhotoFiles = [];
  for (const state of states) {
    state.photoFiles = photoCandidates(state);
    allPhotoFiles.push(...state.photoFiles);
  }
  const commonsMetadata = await fetchCommonsMetadata(allPhotoFiles);
  console.log(`Commons: ${commonsMetadata.size} Bilddatensätze mit Lizenz gefunden`);

  const enrichment = {};
  const stats = {description: 0, facts: 0, links: 0, photos: 0};
  for (const state of states) {
    const entry = {};
    const sources = new Set();

    if (state.tags && Object.keys(state.tags).length) sources.add('openstreetmap');
    if (state.entity) sources.add('wikidata');
    if (state.wikiPage) sources.add('wikipedia');

    const wikiExtract = truncateText(state.wikiPage?.extract ?? '');
    const osmDescription = cleanText(state.tags.description ?? '');
    const wikidataDescription = cleanText(entityDescription(state.entity));

    if (wikiExtract) {
      entry.description = wikiExtract;
      entry.descriptionCredit = `Text: Wikipedia, „${state.wikiPage.title}“, ${WIKIPEDIA_LICENSE}`;
      entry.descriptionSource = wikipediaUrl(state.wikiRef, state.wikiPage.title);
    } else if (osmDescription) {
      entry.description = truncateText(osmDescription);
      entry.descriptionCredit = 'Text: OpenStreetMap-Mitwirkende, ODbL 1.0';
      entry.descriptionSource = osmUrl(state.poi);
    } else if (wikidataDescription) {
      entry.description = truncateText(wikidataDescription);
      entry.descriptionCredit = 'Text: Wikidata, CC0 1.0';
      entry.descriptionSource = state.qid ? `https://www.wikidata.org/wiki/${state.qid}` : '';
    }

    const facts = buildFacts(state, labels);
    const links = buildLinks(state);
    const photos = buildPhotos(state, commonsMetadata);
    if (photos.length) sources.add('commons');

    if (facts.length) entry.facts = facts;
    if (links.length) entry.links = links;
    if (photos.length) entry.photos = photos;
    entry.sources = [...sources].map(key => SOURCE_INFO[key]);

    if (entry.description) stats.description += 1;
    if (entry.facts) stats.facts += 1;
    if (entry.links) stats.links += 1;
    if (entry.photos) stats.photos += 1;

    enrichment[state.poi.id] = entry;
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/enrich_pois.mjs',
    poiCount: mainzTestPois.length,
    enrichedCount: Object.values(enrichment).filter(entry => (
      entry.description || entry.facts?.length || entry.photos?.length
    )).length,
    stats,
    sourceLicenses: SOURCE_INFO,
  };

  const output = `/**
 * AUTO-GENERIERTE DATEI – nicht manuell bearbeiten.
 *
 * Erzeugt von scripts/enrich_pois.mjs.
 * Quellen und Lizenzen:
 * - OpenStreetMap-Mitwirkende, ODbL 1.0: https://www.openstreetmap.org/copyright
 * - Wikidata, CC0 1.0: https://www.wikidata.org/wiki/Wikidata:Licensing
 * - Wikipedia, CC BY-SA 4.0: https://de.wikipedia.org/wiki/Wikipedia:Lizenzbestimmungen
 * - Wikimedia Commons, je Bild: https://commons.wikimedia.org/wiki/Commons:Lizenzen
 *
 * Die Bild-URLs zeigen auf Wikimedia Commons. Die zugehörigen Autor- und
 * Lizenzangaben stehen in photos[].credit, photos[].license und photos[].source.
 */

export const poiEnrichmentMeta = ${JSON.stringify(meta, null, 2)};

export const poiEnrichment = ${JSON.stringify(enrichment, null, 2)};
`;

  await writeFile(OUTPUT_FILE, output, 'utf8');
  console.log(`Geschrieben: ${OUTPUT_FILE}`);
  console.log(JSON.stringify(meta.stats, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
