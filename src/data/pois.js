import {boxModel} from "./models.js";
import {mainz} from "../device/position.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const BUFFER_RADIUS = 1000;

function generateOverpassQuery(lat, lon, radius) {
  const bbox = calculateBbox(lat, lon, radius);
  
  return `
    [out:json];
    (
      node["amenity"](${bbox});
      node["tourism"](${bbox});
      node["historic"](${bbox});
      node["leisure"](${bbox});
      node["shop"](${bbox});
      node["building"](${bbox});
      way["amenity"](${bbox});
      way["tourism"](${bbox});
      way["historic"](${bbox});
      way["leisure"](${bbox});
      way["shop"](${bbox});
      way["building"](${bbox});
      relation["amenity"](${bbox});
      relation["tourism"](${bbox});
      relation["historic"](${bbox});
      relation["leisure"](${bbox});
      relation["shop"](${bbox});
      relation["building"](${bbox});
    );
    out center;
  `;
}

function calculateBbox(lat, lon, radius) {
  const earthRadius = 6378137;
  const latRadians = lat * Math.PI / 180;
  const lonRadians = lon * Math.PI / 180;
  
  const deltaLat = radius / earthRadius * 180 / Math.PI;
  const deltaLon = radius / (earthRadius * Math.cos(latRadians)) * 180 / Math.PI;
  
  const minLat = lat - deltaLat;
  const maxLat = lat + deltaLat;
  const minLon = lon - deltaLon;
  const maxLon = lon + deltaLon;
  
  return `${minLat},${minLon},${maxLat},${maxLon}`;
}

function elementToPoi(element, center) {
  const lat = element.lat || element.center?.lat || 0;
  const lon = element.lon || element.center?.lon || 0;
  
  const distance = haversineDistance(lat, lon, center.lat, center.lon);
  if (distance > BUFFER_RADIUS) return null;
  
  const name = getName(element);
  if (!name) return null;
  
  const poi = {
    id: `${element.type}-${element.id}`,
    name: name,
    lat: lat,
    lon: lon,
    subtitle: getSubtitle(element),
    source: getSourceUrl(element),
  };
  
  const type = element.tags?.amenity || element.tags?.tourism || element.tags?.historic || element.tags?.leisure || element.tags?.building || element.tags?.shop;
  
  if (type) {
    poi.type = type;
  }
  
  return poi;
}

function getName(element) {
  return element.tags?.name || 
         element.tags?.["name:de"] ||
         element.tags?.brand ||
         element.tags?.operator ||
         null;
}

function getSubtitle(element) {
  const tags = element.tags || {};
  const types = [];
  
  if (tags.amenity) types.push(tags.amenity);
  if (tags.tourism) types.push(tags.tourism);
  if (tags.historic) types.push(tags.historic);
  if (tags.leisure) types.push(tags.leisure);
  if (tags.building) types.push(tags.building);
  if (tags.shop) types.push(tags.shop);
  
  if (types.length > 0) {
    return types.join(" · ");
  }
  
  return "Point of Interest";
}

function getSourceUrl(element) {
  const type = element.type;
  const id = element.id;
  
  if (type === "node") {
    return `https://www.openstreetmap.org/node/${id}`;
  } else if (type === "way") {
    return `https://www.openstreetmap.org/way/${id}`;
  } else if (type === "relation") {
    return `https://www.openstreetmap.org/relation/${id}`;
  }
  return "https://www.openstreetmap.org";
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1000;
}

export async function loadPois(position) {
  if (!position || !position.lat || !position.lon) {
    console.error("Invalid position for Overpass query");
    return [];
  }
  
  try {
    const query = generateOverpassQuery(position.lat, position.lon, BUFFER_RADIUS);
    const params = new URLSearchParams({ data: query });
    const response = await fetch(`${OVERPASS_URL}?${params}`);
    
    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`);
    }
    
    const data = await response.json();
    const pois = [];
    
    for (const element of data.elements || []) {
      const poi = elementToPoi(element, position);
      if (poi) {
        pois.push(poi);
      }
    }
    
    return pois;
  } catch (error) {
    console.error("Error loading POIs from Overpass API:", error);
    return [];
  }
}

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
