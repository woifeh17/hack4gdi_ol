const key = 'windowlens.atlas.v1';

export function createAtlas(storage) {
  const read = () => {
    const target = storage ?? globalThis.localStorage;
    const data = JSON.parse(target.getItem(key) ?? '{"objects":[],"journeys":[]}');
    if (!data || !Array.isArray(data.objects) || !Array.isArray(data.journeys)) throw new Error('Atlasformat ungültig.');
    return data;
  };
  function update(change) {
    const data = read();
    change(data);
    (storage ?? globalThis.localStorage).setItem(key, JSON.stringify(data));
  }
  return {
    read,
    collect(poiId) {
      update(data => {
        if (!data.objects.some(object => object.poiId === poiId)) {
          data.objects.push({poiId, collectedAt: new Date().toISOString()});
        }
      });
    },
    saveJourney(journey) { update(data => data.journeys.push(journey)); },
  };
}
