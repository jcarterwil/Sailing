/**
 * Whether replay map sources/layers still need to be added for the current style.
 * Both `load` and `styledata` can fire on first paint; re-adding `"trails"` throws.
 */
export function needsReplayMapLayers(map: {
  getSource: (id: string) => unknown;
}): boolean {
  return map.getSource("trails") == null;
}
