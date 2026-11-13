// A small bias for the center of view and important landmarks breaks close ties.
export function poiScore(distance, point, priority, wasVisible) {
  const centerOffset = 2 * Math.max(Math.abs(point.x - 0.5), Math.abs(point.y - 0.5));
  const edgePenalty = Math.min(45, distance * 0.12) * centerOffset;
  const priorityBonus = priority === 1 ? Math.min(30, distance * 0.12) : 0;
  const stabilityBonus = wasVisible ? Math.min(25, distance * 0.10) : 0;
  return distance + edgePenalty - priorityBonus - stabilityBonus;
}
