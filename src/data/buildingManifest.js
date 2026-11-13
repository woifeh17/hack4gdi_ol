// Mutate the existing POI objects so Leaflet, atlas, and AR retain the same catalogue.
// Only entries whose files are present in the generated manifest get enabled.
export function applyBuildingManifest(pois, manifest) {
  const items = manifest?.buildings ?? {};
  let enabled = 0;
  for (const poi of pois) {
    const item = items[poi.id];
    if (!item?.file || !/^[a-z0-9][a-z0-9_-]*\.geojson$/.test(item.file)) continue;
    poi.building = {
      ...poi.building,
      enabled: true,
      url: `./assets/buildings/${item.file}`,
      osmId: item.osmId ?? poi.building?.osmId ?? null,
      defaultHeight: item.defaultHeight ?? poi.building?.defaultHeight ?? 12,
      geometryStatus: 'static',
    };
    enabled++;
  }
  return enabled;
}
