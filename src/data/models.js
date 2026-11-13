// Vereinfachtes lokales Gebäudemodell in Ost/Nord/Oben, Meter relativ zum POI.
export function boxModel(width, length, height) {
  const base = [[-width/2, -length/2], [width/2, -length/2], [width/2, length/2], [-width/2, length/2]];
  return {
    vertices: [0, height].flatMap(z => base.map(([x, y]) => [x, y, z])),
    edges: [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]],
  };
}
