// Node ESM: read the same catalogue used by AR and export candidate way IDs.
import {pois} from '../src/data/mainzTestPois.js';

const estimates = {
  arena: 26, bonifazius: 50, 'zdf-hochhaus': 38,
  'st-georg-bretzenheim': 18, 'st-bonifaz': 18,
  'st-bernhard-bretzenheim': 17, 'st-achatius-zahlbach': 18,
  'melanchthonkirche': 16, 'alte-lokhalle': 16,
  'schott-b': 15, 'zdf-sendezentrum2': 20,
};

const rows = pois.map(poi => {
  const ref = poi.building?.osmId ?? poi.osmRef;
  if (!/^way\/\d+$/.test(ref ?? '')) return null;
  return {
    id: poi.id,
    name: poi.name,
    lat: poi.lat,
    lon: poi.lon,
    osmRef: ref,
    defaultHeight: estimates[poi.id] ?? 12,
  };
}).filter(Boolean);

process.stdout.write(JSON.stringify(rows));
