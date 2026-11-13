#!/usr/bin/env python3
"""Export curated Mainz building ways from a local Geofabrik OSM PBF.

Dependencies: Python 3.10+, Node.js, pip install osmium
Usage: python scripts/export_mainz_buildings.py /path/to/rheinland-pfalz-latest.osm.pbf

This runs offline against a downloaded PBF. No Overpass, OSM API or browser CORS.
Only ways actually tagged as buildings are published; non-buildings are skipped.
No heights/roofs are invented: missing heights are explicitly estimated at runtime.
"""
import json
import math
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'assets' / 'buildings'
IMPORTANT_TAGS = (
    'building', 'building:part', 'height', 'building:height',
    'building:levels', 'min_height', 'building:min_height',
    'building:min_level', 'roof:shape', 'roof:height',
    'roof:levels', 'name', 'building:colour', 'roof:colour',
)


def distance_m(lat1, lon1, lat2, lon2):
    lat = math.radians((lat1 + lat2) / 2)
    return math.hypot((lat1-lat2)*111195, (lon1-lon2)*111195*math.cos(lat))


def target_list():
    raw = subprocess.check_output(['node', 'scripts/list_building_candidates.mjs'], cwd=ROOT)
    return json.loads(raw)


def export(pbf_path):
    try:
        import osmium
    except ImportError as exc:
        raise SystemExit('pyosmium missing. Install with: python -m pip install osmium') from exc

    targets = target_list()
    indexed = {int(t['osmRef'].split('/')[1]): t for t in targets}
    ways = {}
    node_ids = set()

    class Ways(osmium.SimpleHandler):
        def way(self, way):
            if way.id not in indexed:
                return
            tags = dict(way.tags)
            if not (tags.get('building') or tags.get('building:part')):
                print(f"SKIP {indexed[way.id]['id']}: OSM way is not tagged as a building")
                return
            refs = [node.ref for node in way.nodes]
            if len(refs) < 4 or refs[0] != refs[-1]:
                print(f"SKIP {indexed[way.id]['id']}: building has no closed exterior ring")
                return
            ways[way.id] = (refs, tags)
            node_ids.update(refs)

    print(f'Scanning {pbf_path} for {len(indexed)} candidate ways (pass 1/2)', flush=True)
    Ways().apply_file(str(pbf_path))
    coords = {}

    class Nodes(osmium.SimpleHandler):
        def node(self, node):
            if node.id in node_ids and node.location.valid():
                coords[node.id] = [round(node.location.lon, 7), round(node.location.lat, 7)]

    print(f'Resolving {len(node_ids)} footprint vertices (pass 2/2)', flush=True)
    Nodes().apply_file(str(pbf_path))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = {
        'source': 'OpenStreetMap contributors / Geofabrik Rheinland-Pfalz extract',
        'license': 'ODbL-1.0',
        'buildings': {},
    }

    for way_id, (refs, tags) in ways.items():
        poi = indexed[way_id]
        if any(node not in coords for node in refs):
            print(f"SKIP {poi['id']}: missing node locations")
            continue
        ring = [coords[node] for node in refs]
        lon_center = (min(x for x, _ in ring) + max(x for x, _ in ring)) / 2
        lat_center = (min(y for _, y in ring) + max(y for _, y in ring)) / 2
        if distance_m(poi['lat'], poi['lon'], lat_center, lon_center) > 350:
            print(f"SKIP {poi['id']}: OSM geometry is more than 350 m away from POI")
            continue
        # Reject extremely large areas even if building tags are erroneous.
        width = distance_m(lat_center, min(x for x,_ in ring), lat_center, max(x for x,_ in ring))
        length = distance_m(min(y for _,y in ring),lon_center,max(y for _,y in ring),lon_center)
        if max(width, length) > 550:
            print(f"SKIP {poi['id']}: footprint is suspiciously large ({width:.0f}×{length:.0f} m)")
            continue
        filename = f"{poi['id']}.geojson"
        feature = {
            'type': 'Feature',
            'id': f'way/{way_id}',
            'properties': {key: tags[key] for key in IMPORTANT_TAGS if key in tags},
            'geometry': {'type':'Polygon', 'coordinates': [ring]},
        }
        path = OUTPUT / filename
        path.write_text(json.dumps({
            'type': 'FeatureCollection',
            'features': [feature],
        }, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
        manifest['buildings'][poi['id']] = {
            'file': filename, 'osmId': f'way/{way_id}',
            'defaultHeight': poi['defaultHeight'],
        }
        print(f'OK {poi["id"]} -> {filename} ({len(ring)-1} footprint vertices)')

    (OUTPUT/'manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Exported {len(manifest["buildings"])} building files. ',
          f'Skipped {len(indexed) - len(manifest["buildings"])} candidate POIs.')
    return len(manifest['buildings'])


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python scripts/export_mainz_buildings.py /path/to/rheinland-pfalz-latest.osm.pbf')
    source = Path(sys.argv[1])
    if not source.is_file():
        raise SystemExit(f'OSM PBF not found: {source}')
    count = export(source)
    if count == 0:
        raise SystemExit('No OSM building geometries exported; check PBF and OSM way IDs')
