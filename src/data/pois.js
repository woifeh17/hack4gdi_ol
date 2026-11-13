import {boxModel} from "./models.js";

// Pfad zur GeoJSON-Datei
const GEOJSON_PATH = "./poi.geojson";

// Funktion zur Extraktion eines sinnvollen Names aus den OSM-Properties
function extractName(properties) {
  return properties.name || 
         properties["name:de"] ||
         properties.amenity ||
         properties.building ||
         properties["tourism"] ||
         properties.shop ||
         properties.office ||
         properties.id ||
         "Unbekannter POI";
}

// Funktion zur Extraktion einer Beschreibung/Subtitle
function extractSubtitle(properties) {
  const parts = [];
  
  if (properties.amenity) {
    const amenityNames = {
      'bicycle_parking': 'Fahrradparkplatz',
      'bench': 'Bank',
      'shelter': 'Unterstand',
      'waste_basket': 'Abfalleimer',
      'recycling': 'Recyclingstation',
      'bicycle_rental': 'Fahrradverleih',
      'bicycle_repair_station': 'Fahrradreparaturstation',
      'drinking_water': 'Trinkwasser',
      'fountain': 'Brunnen',
      'clock': 'Uhr',
      'post_box': 'Briefkasten',
      'telephone': 'Telefonzelle',
      'toilets': 'Toiletten',
      'restaurant': 'Restaurant',
      'cafe': 'Cafe',
      'bar': 'Bar',
      'pub': 'Kneipe',
      'fast_food': 'Schnellimbiss',
      'bank': 'Bank',
      'atm': 'Geldautomat',
      'pharmacy': 'Apotheke',
      'hospital': 'Krankenhaus',
      'doctors': 'Arztpraxis',
      'school': 'Schule',
      'kindergarten': 'Kindergarten',
      'library': 'Bibliothek',
      'community_centre': 'Gemeinschaftszentrum',
      'place_of_worship': 'Gotteshaus',
      'fire_station': 'Feuerwache',
      'police': 'Polizeistation',
      'post_office': 'Postamt',
      'townhall': 'Rathaus',
      'courthouse': 'Gericht',
      'prison': 'Gefangnis',
      'parking': 'Parkplatz',
      'fuel': 'Tankstelle',
      'charging_station': 'Ladestation'
    };
    const amenityDe = amenityNames[properties.amenity] || properties.amenity;
    parts.push(amenityDe);
  }
  
  if (properties.building) {
    parts.push(properties.building);
  }
  
  if (properties.shop) {
    parts.push(properties.shop);
  }
  
  if (properties.tourism) {
    const tourismNames = {
      'hotel': 'Hotel',
      'guest_house': 'Gastehaus',
      'hostel': 'Hostel',
      'motel': 'Motel',
      'camp_site': 'Campingplatz',
      'caravan_site': 'Wohnmobilstellplatz',
      'museum': 'Museum',
      'artwork': 'Kunstwerk',
      'attraction': 'Sehenswurdigkeit',
      'viewpoint': 'Aussichtspunkt',
      'picnic_site': 'Picknickplatz',
      'alpine_hut': 'Berghutte'
    };
    const tourismDe = tourismNames[properties.tourism] || properties.tourism;
    parts.push(tourismDe);
  }
  
  if (properties.office) {
    parts.push(properties.office);
  }
  
  if (properties.operator) {
    parts.push(`· ${properties.operator}`);
  }
  
  if (properties["brand"]) {
    parts.push(`· ${properties["brand"]}`);
  }
  
  if (properties.capacity) {
    parts.push(`· Kapazitat: ${properties.capacity}`);
  }
  
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

// Funktion zur Extraktion einer Quelle/URL
function extractSource(properties) {
  if (properties.website) return properties.website;
  if (properties["contact:website"]) return properties["contact:website"];
  if (properties.url) return properties.url;
  if (properties["wikidata"]) return `https://www.wikidata.org/wiki/${properties["wikidata"]}`;
  if (properties["wikipedia"]) return `https://de.wikipedia.org/wiki/${properties["wikipedia"]}`;
  if (properties["@id"]) return `https://www.openstreetmap.org/${properties["@id"]}`;
  return undefined;
}

// Funktion zur Extraktion eines OSM-Referenz-IDs
function extractOsmRef(properties, featureId) {
  return properties["@id"] || properties.id || featureId || undefined;
}

// Funktion zur Bestimmung der POI-Kategorie basierend auf OSM-Tags
function extractCategory(properties) {
  if (properties.amenity === 'bicycle_parking') return 'Verkehr';
  if (properties.amenity === 'bench' || properties.amenity === 'shelter') return 'Offentlich';
  if (properties.amenity === 'restaurant' || properties.amenity === 'cafe' || 
      properties.amenity === 'bar' || properties.amenity === 'pub' ||
      properties.amenity === 'fast_food') return 'Gastronomie';
  if (properties.amenity === 'school' || properties.amenity === 'kindergarten' ||
      properties.amenity === 'library' || properties.amenity === 'university') return 'Bildung';
  if (properties.amenity === 'hospital' || properties.amenity === 'doctors' ||
      properties.amenity === 'pharmacy') return 'Gesundheit';
  if (properties.amenity === 'place_of_worship') return 'Religion';
  if (properties.amenity === 'bank' || properties.amenity === 'atm') return 'Finanzen';
  if (properties.amenity === 'post_box' || properties.amenity === 'post_office') return 'Post';
  if (properties.amenity === 'fuel' || properties.amenity === 'charging_station') return 'Verkehr';
  if (properties.amenity === 'parking') return 'Verkehr';
  if (properties.tourism) return 'Tourismus';
  if (properties.shop) return 'Einkauf';
  if (properties.building) return 'Gebaude';
  if (properties.office) return 'Buro';
  return 'Sonstiges';
}

// Funktion zur Konvertierung eines GeoJSON-Features in ein POI-Objekt
function featureToPoi(feature, index) {
  const props = feature.properties || {};
  const geometry = feature.geometry;
  
  // Nur Point-Geometrien verarbeiten
  if (!geometry || geometry.type !== 'Point') {
    return null;
  }
  
  const [lon, lat] = geometry.coordinates;
  const id = props.id || props["@id"] || feature.id || `poi-${index}`;
  const name = extractName(props);
  
  // Wenn kein Name, ueberspringen
  if (!name || name === 'Unbekannter POI') {
    return null;
  }
  
  // Subtitle extrahieren
  const subtitle = extractSubtitle(props);
  
  // Quelle extrahieren
  const source = extractSource(props);
  
  // Standard-POI-Objekt erstellen
  const poi = {
    id: id.replace(/[/:\?\*"<>&|]/g, '_'),
    name: name,
    lat: lat,
    lon: lon,
  };
  
  // Optionale Felder hinzufuegen, falls vorhanden
  if (subtitle) {
    poi.subtitle = subtitle;
  }
  
  if (source) {
    poi.source = source;
  }
  
  // OSM-Referenz hinzufuegen
  poi.osmRef = extractOsmRef(props, feature.id);
  
  // Kategorie hinzufuegen
  poi.category = extractCategory(props);
  
  // Spezifische POIs mit Modellen
  const specialPois = {
    'way/24948579': { model: boxModel(30, 30, 16), building: {enabled: true, searchRadiusM: 100, defaultHeight: 16} },
    'way/155183071': { building: {enabled: false} },
    'node/13469955871': {},
    'way/275819547': {},
    'way/227025898': {},
    'way/91231800': { model: boxModel(165, 190, 28), building: {enabled: true, searchRadiusM: 240, defaultHeight: 28} },
    'node/5096600671': { model: boxModel(18, 9, 7), building: {enabled: true, searchRadiusM: 75, defaultHeight: 7} }
  };
  
  const specialPoi = specialPois[id] || specialPois[props["@id"]] || {};
  if (specialPoi.model) {
    poi.model = specialPoi.model;
  }
  if (specialPoi.building) {
    poi.building = specialPoi.building;
  }
  
  return poi;
}

// GeoJSON-Features in POIs konvertieren
function convertGeoJsonToPois(geoJson) {
  if (!geoJson || !geoJson.features) {
    console.warn('Keine Features in der GeoJSON gefunden');
    return [];
  }
  
  const pois = [];
  
  for (let i = 0; i < geoJson.features.length; i++) {
    const feature = geoJson.features[i];
    const poi = featureToPoi(feature, i);
    
    if (poi) {
      pois.push(poi);
    }
  }
  
  return pois;
}

// POIs asynchron aus der GeoJSON-Datei laden
let poisCache = null;

export async function loadPois() {
  if (poisCache) {
    return poisCache;
  }
  
  try {
    const response = await fetch(GEOJSON_PATH);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const geoJson = await response.json();
    poisCache = convertGeoJsonToPois(geoJson);
    
    console.log(`POIs aus GeoJSON geladen: ${poisCache.length}`);
    return poisCache;
  } catch (error) {
    console.error('Fehler beim Laden der GeoJSON-Datei:', error);
    // Fallback: leeres Array
    poisCache = [];
    return poisCache;
  }
}

<<<<<<< HEAD
// Default Export fuer direkte Kompatibilitaet - als Promise
export const pois = loadPois();
=======
async function loadPoisWithRetry(position, maxRetries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const pois = await loadPois(position);
    if (pois.length > 0) {
      return pois;
    }
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return [];
}

export async function loadPoisForCurrentPosition(positionProvider) {
  if (!positionProvider || !positionProvider.current) {
    console.error("Invalid position provider");
    return [];
  }
  
  return loadPoisWithRetry(positionProvider.current);
}

export const fallbackPois = [
  {id:'arena', model:boxModel(165, 190, 28), building:{enabled:true, searchRadiusM:240, defaultHeight:28}, name:'MEWA Arena', lat:49.983956, lon:8.224387, subtitle:'Fußballstadion · 1. FSV Mainz 05', source:'https://www.outdooractive.com/de/poi/rheinhessen/mewa-arena/25271942/'},
  {id:'garten', name:'Botanischer Garten JGU', lat:49.990938, lon:8.240678, subtitle:'Botanischer Garten · Universität Mainz', source:'https://www.outdooractive.com/de/poi/rheinhessen/botanischer-garten-der-johannes-gutenberg-universitaet-mainz/12023487/'},
  {id:'aquaedukt', name:'Römisches Aquädukt · Infotafel', lat:49.98774, lon:8.22961, subtitle:'Informationstafel zur römischen Wasserleitung', source:'https://mapcarta.com/de/N13469955871'},
  {id:'friedhof', name:'Neuer Jüdischer Friedhof', lat:49.98563, lon:8.23285, subtitle:'Geschütztes Kulturdenkmal · Mainz-Bretzenheim', source:'https://mapcarta.com/de/W275819547'},
  {id:'coface', name:'Coface-See', lat:49.99437, lon:8.22303, subtitle:'Wasserfläche · Kisselberg', source:'https://mapcarta.com/W227025898'},
  {id:'reaktor', model:boxModel(30, 30, 16), building:{enabled:true, searchRadiusM:100, defaultHeight:16}, name:'Forschungsreaktor Mainz', lat:49.992413, lon:8.237325, subtitle:'Forschungseinrichtung · Johannes Gutenberg-Universität', source:'https://de.wikipedia.org/wiki/Forschungsreaktor_Mainz'},
  {id:'gonsenheim', model:boxModel(18, 9, 7), building:{enabled:true, searchRadiusM:75, defaultHeight:7}, name:'Bahnhof Mainz-Gonsenheim', lat:49.99774, lon:8.21431, subtitle:'Regionalbahnhalt · Mainz-Gonsenheim', source:'https://mapcarta.com/de/18094116'},
];

export const pois = fallbackPois;

export function createPoiLoader(positionProvider, options = {}) {
  const {
    onUpdate = () => {},
    minIntervalMs = 5000,
    minDistanceM = 100,
  } = options;
  
  let lastPois = [...fallbackPois];
  let lastPosition = null;
  let lastUpdate = 0;
  let isLoading = false;
  let loadPromise = null;
  
  function shouldUpdate(newPosition) {
    if (!newPosition || !newPosition.lat || !newPosition.lon) return false;
    
    if (!lastPosition) return true;
    
    const now = Date.now();
    if (now - lastUpdate < minIntervalMs) return false;
    
    const distance = haversineDistance(
      lastPosition.lat, lastPosition.lon,
      newPosition.lat, newPosition.lon
    );
    
    return distance >= minDistanceM;
  }
  
  async function loadAndUpdate(newPosition) {
    if (isLoading) return loadPromise;
    if (!shouldUpdate(newPosition)) return lastPois;
    
    isLoading = true;
    lastPosition = {...newPosition};
    
    loadPromise = loadPoisWithRetry(newPosition).then(newPois => {
      lastPois = newPois.length > 0 ? newPois : [...fallbackPois];
      lastUpdate = Date.now();
      isLoading = false;
      loadPromise = null;
      onUpdate(lastPois, newPosition);
      return lastPois;
    }).catch(error => {
      console.error("Failed to load POIs:", error);
      isLoading = false;
      loadPromise = null;
      return lastPois;
    });
    
    return loadPromise;
  }
  
  return {
    get current() { return lastPois; },
    get loading() { return isLoading; },
    update: loadAndUpdate,
    refresh: () => {
      if (!positionProvider || !positionProvider.current) return Promise.resolve(lastPois);
      return loadAndUpdate(positionProvider.current);
    },
  };
}
>>>>>>> c330c53 (fix sk's breaking LiquidGlass changes)
