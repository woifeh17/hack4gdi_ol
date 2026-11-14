#!/usr/bin/env python3
"""Match POIs to CityGML buildings and publish shaded mesh tiles."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date
from hashlib import sha256
from itertools import product
import json
from math import floor
from pathlib import Path
import re
import subprocess
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import mapbox_earcut
import numpy as np
from pyproj import Geod, Transformer
from shapely import make_valid, transform, union_all
from shapely.geometry import Point, Polygon, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[1]
GML_ID = '{http://www.opengis.net/gml}id'
RLP_URL = 'https://geobasis-rlp.de/data/geb3dlo/current/gml'
GEOD = Geod(ellps='WGS84')
POINT_RADIUS = 12
SURFACES = {'GroundSurface': 'ground', 'RoofSurface': 'roof',
            'WallSurface': 'wall', 'ClosureSurface': 'wall',
            'OuterCeilingSurface': 'wall', 'OuterFloorSurface': 'wall'}
NON_BUILDING_TAGS = {'cemetery', 'grave_yard', 'water', 'garden', 'pitch', 'track'}
NON_BUILDING_CATEGORIES = {'Natur'}
MAINZ_POINT_EXCLUSIONS = {'aquaedukt', 'marienborn', 'gonsenheim'}


def local_name(element):
    return element.tag.rsplit('}', 1)[-1]


def polygon_rings(polygon):
    rings = []
    for boundary in polygon:
        if local_name(boundary) not in {'exterior', 'interior'}:
            continue
        coords = boundary.find('.//{*}posList')
        if coords is not None and coords.text:
            ring = np.fromstring(coords.text, sep=' ').reshape((-1, 3))
        else:
            ring = np.array([list(map(float, pos.text.split()))
                             for pos in boundary.findall('.//{*}pos')])
        if len(ring) and np.array_equal(ring[0], ring[-1]):
            ring = ring[:-1]
        if len(ring) < 3:
            return []
        if local_name(boundary) == 'exterior':
            rings.insert(0, ring)
        else:
            rings.append(ring)
    return rings


def read_building(member):
    building = next(iter(member), None)
    if building is None or local_name(building) != 'Building':
        return None
    identifier = building.get(GML_ID)
    faces = []
    ground = []
    roof = []
    # The official tiles store polygons under semantic surfaces. lod2Solid
    # references those same polygons by XLink. Include parts of the same building.
    for surface in building.iter():
        kind = SURFACES.get(local_name(surface))
        if not kind:
            continue
        for geometry in surface.findall('{*}lod2MultiSurface'):
            for polygon in geometry.findall('.//{*}Polygon'):
                rings = polygon_rings(polygon)
                if not rings:
                    continue
                if kind != 'wall':
                    footprint = make_valid(Polygon(rings[0][:, :2], [r[:, :2] for r in rings[1:]]))
                    if footprint.area:
                        (ground if kind == 'ground' else roof).append(footprint)
                faces.append((kind, rings))
    if not identifier or not faces or not (ground or roof):
        return None
    footprint = union_all(ground or roof)
    return identifier, footprint, faces


def city_members(stream):
    events = ET.iterparse(stream, events=('start', 'end'))
    _, root = next(events)
    for event, element in events:
        if event == 'end' and local_name(element) == 'cityObjectMember':
            yield element
            root.remove(element)


@contextmanager
def gml_streams(path):
    if path.suffix.lower() == '.zip':
        with ZipFile(path) as archive:
            yield (archive.open(name) for name in archive.namelist()
                   if name.lower().endswith(('.gml', '.xml')))
    else:
        yield iter([path.open('rb')])


def download(url, destination):
    if destination.exists():
        return destination
    temp = destination.with_suffix(destination.suffix + '.part')
    request = Request(url, headers={'User-Agent': 'Bahnorama Hack4GDI building exporter'})
    with urlopen(request, timeout=120) as response, temp.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    temp.replace(destination)
    return destination


def osm_way(path):
    root = ET.parse(path).getroot()
    way = root.find('way')
    tags = {tag.get('k'): tag.get('v') for tag in way.findall('tag')}
    if NON_BUILDING_TAGS.intersection(tags.values()):
        return False
    if not (tags.get('building') not in (None, 'no') or
            tags.get('leisure') in {'stadium', 'sports_centre', 'water_park'} or
            tags.get('amenity') in {'school', 'university', 'college'} or
            tags.get('historic') in {'industrial', 'building'}):
        return None
    nodes = {node.get('id'): (float(node.get('lon')), float(node.get('lat')))
             for node in root.findall('node')}
    refs = [node.get('ref') for node in way.findall('nd')]
    if len(refs) >= 4 and refs[0] == refs[-1]:
        return make_valid(Polygon([nodes[ref] for ref in refs]))
    return None


def prepare_targets(pois, project, extents, osm_cache, use_osm):
    targets = []
    for poi in pois:
        identifier = poi['id']
        if poi.get('category') in NON_BUILDING_CATEGORIES or poi.get('buildingMatch') is False:
            continue
        extent = extents.get(identifier)
        ref = poi.get('osmRef') or ''
        if extent is None and use_osm and re.fullmatch(r'way/\d+', ref):
            path = download(f'https://www.openstreetmap.org/api/0.6/{ref}/full',
                            osm_cache / f"{ref.split('/')[-1]}.osm")
            extent = osm_way(path)
        if extent is False:
            continue
        anchor = Point(*project(poi['lon'], poi['lat']))
        targets.append((poi, anchor, transform(extent, project, interleaved=False) if extent is not None and extent.area else None))
    return targets


def match(target, index, footprints):
    _, anchor, extent = target
    if extent is not None:
        selected = []
        for i in index.query(extent, predicate='intersects'):
            footprint = footprints[i]
            # Exclude nearby buildings that only touch or slightly cross the site boundary.
            if footprint.intersection(extent).area >= max(2, 0.45 * footprint.area):
                selected.append(i)
        return sorted(selected)
    nearby = index.query(anchor, predicate='dwithin', distance=POINT_RADIUS)
    if len(nearby):
        return [min(nearby, key=lambda i: (footprints[i].distance(anchor), i))]
    return []


def triangulate(rings):
    outer = rings[0] - rings[0][0]
    normal = np.cross(outer, np.roll(outer, -1, axis=0)).sum(axis=0)
    axis = int(np.argmax(abs(normal)))
    if abs(normal[axis]) < 1e-8:
        return []
    coords = np.concatenate(rings)
    ends = np.cumsum([len(ring) for ring in rings], dtype=np.uint32)
    plane = np.delete(coords - coords[0], axis, axis=1)
    indices = mapbox_earcut.triangulate_float64(plane, ends).reshape((-1, 3))
    triangles = coords[indices]
    cross = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    for triangle, direction in zip(triangles, cross @ normal):
        if abs(direction) > 1e-10:
            yield triangle if direction > 0 else triangle[[0, 2, 1]]


def mesh(footprint, faces, unproject):
    origin = footprint.centroid
    lon, lat = unproject(origin.x, origin.y)
    ground = min(p[2] for kind, rings in faces for p in rings[0] if kind == 'ground') if any(
        kind == 'ground' for kind, _ in faces) else min(p[2] for _, rings in faces for p in rings[0])
    vertices = {}
    triangles = []
    for kind, rings in faces:
        if kind == 'ground':
            continue
        for triangle in triangulate(rings):
            indices = [vertices.setdefault(tuple(p), len(vertices)) for p in triangle]
            triangles.append([int(kind == 'roof'), *indices])
    if not triangles:
        return None
    coordinates = np.array(list(vertices))
    lons, lats = unproject(coordinates[:, 0], coordinates[:, 1])
    azimuth, _, distance = GEOD.inv(np.full(len(lons), lon), np.full(len(lats), lat), lons, lats)
    azimuth = np.radians(azimuth)
    enu = np.column_stack([distance * np.sin(azimuth), distance * np.cos(azimuth), coordinates[:, 2] - ground])
    return {'origin': [round(lon, 8), round(lat, 8), round(ground, 3)],
            'vertices': enu.round(3).tolist(), 'triangles': triangles}


def write_json(path, data):
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + '\n'
    path.write_text(payload, encoding='utf-8')
    return sha256(payload.encode()).hexdigest()[:16]


def export(args):
    project = Transformer.from_crs(4326, args.crs, always_xy=True).transform
    unproject = Transformer.from_crs(args.crs, 4326, always_xy=True).transform
    if args.catalog:
        pois = json.loads(args.catalog.read_text())
    else:
        pois = json.loads(subprocess.check_output(['node', ROOT / 'scripts/list_lod2_pois.mjs']))
        pois = [poi for poi in pois if poi['id'] not in MAINZ_POINT_EXCLUSIONS]
    extents = {}
    if args.extents:
        data = json.loads(args.extents.read_text())
        extents = {feature['properties']['id']: shape(feature['geometry']) for feature in data['features']}
    args.cache.mkdir(parents=True, exist_ok=True)
    targets = prepare_targets(pois, project, extents, args.cache, args.osm_ways)
    if not targets:
        raise ValueError('No eligible POIs')
    search_areas = [extent if extent is not None else anchor.buffer(POINT_RADIUS)
                    for _, anchor, extent in targets]
    search = STRtree(search_areas)
    inputs = args.citygml
    if args.rlp:
        if args.crs != 25832:
            raise ValueError('The RLP download uses EPSG:25832')
        tiles = set()
        # The current bulk download publishes 2 km tiles. Include neighbors
        # for buildings whose source tile is assigned by centroid.
        for area in search_areas:
            x0, y0, x1, y1 = area.buffer(250).bounds
            tiles.update(product(range(floor(x0 / 2000), floor(x1 / 2000) + 1),
                                 range(floor(y0 / 2000), floor(y1 / 2000) + 1)))
        names = [f'LoD2_32_{x * 2}_{y * 2}_2_RP.gml' for x, y in sorted(tiles)]
        with ThreadPoolExecutor(max_workers=4) as pool:
            inputs = list(pool.map(lambda name: download(f'{RLP_URL}/{name}', args.cache / name), names))
    buildings = {}
    for path in inputs:
        print(f'Reading {path.name}', flush=True)
        with gml_streams(path) as streams:
            for stream in streams:
                with stream:
                    for member in city_members(stream):
                        record = read_building(member)
                        if record and len(search.query(record[1], predicate='intersects')):
                            identifier, footprint, faces = record
                            buildings[identifier] = (footprint, faces)
    ids = sorted(buildings)
    footprints = [buildings[identifier][0] for identifier in ids]
    index = STRtree(footprints)
    models = {}
    tiles = {}
    links = {}
    for target in targets:
        poi = target[0]
        matched = []
        for i in match(target, index, footprints):
            identifier = ids[i]
            if identifier not in models:
                footprint, faces = buildings[identifier]
                model = mesh(footprint, faces, unproject)
                origin = footprint.centroid
                tile = f'{args.crs}-{floor(origin.x / 1000)}-{floor(origin.y / 1000)}'
                models[identifier] = (tile, model)
                if model is not None:
                    tiles.setdefault(tile, {})[identifier] = model
            tile, model = models[identifier]
            if model is not None:
                matched.append([tile, identifier])
        if matched:
            links[poi['id']] = matched
        print(f"{poi['id']}: {len(matched)} LoD2 building(s)")
    if not links:
        raise ValueError('No matching LoD2 models; output unchanged')
    args.output.mkdir(parents=True, exist_ok=True)
    files = {}
    for tile, models in tiles.items():
        temp = args.output / f'{tile}.tmp'
        digest = write_json(temp, {'version': 1, 'buildings': models})
        files[tile] = f'{tile}-{digest}.json'
        temp.replace(args.output / files[tile])
    manifest = {'version': 1, 'source': args.attribution, 'tiles': files, 'pois': links}
    temp = args.output / 'manifest.tmp'
    write_json(temp, manifest)
    temp.replace(args.output / 'manifest.json')
    print(f'Exported {len(links)} POIs, {sum(map(len, tiles.values()))} buildings, {len(files)} mesh tiles')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, help='JSON array of POIs (id, lat, lon, optional osmRef)')
    parser.add_argument('--extents', type=Path, help='WGS84 GeoJSON of POI areas, keyed by properties.id')
    parser.add_argument('--crs', type=int, default=25832, help='Input projected EPSG code in metres')
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--rlp', action='store_true', help='Download current RLP bulk tiles covering the POIs')
    source.add_argument('--citygml', type=Path, nargs='+', help='Local CityGML files or ZIP archives')
    parser.add_argument('--osm-ways', action='store_true', help='Resolve OSM way extents during export')
    parser.add_argument('--cache', type=Path, default=Path('.lod2-cache'))
    parser.add_argument('--output', type=Path, default=ROOT / 'assets/buildings/lod2')
    parser.add_argument('--attribution', default=f'© GeoBasis-DE / LVermGeoRP {date.today().year}, dl-de/by-2-0, www.lvermgeo.rlp.de [Daten bearbeitet]')
    export(parser.parse_args())


if __name__ == '__main__':
    main()
