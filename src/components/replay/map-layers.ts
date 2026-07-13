/**
 * Whether replay map sources/layers still need to be added for the current style.
 * Both `load` and `styledata` can fire on first paint; re-adding `"trails"` throws.
 */
export function needsReplayMapLayers(map: {
  getSource: (id: string) => unknown;
}): boolean {
  return map.getSource("trails") == null;
}

/**
 * Whether `addLayers` should run now: only when the replay layers are missing AND no add pass is
 * already in flight. `addSource`/`addImage` can emit `styledata` synchronously, which re-enters
 * `addLayers`; without the `isAdding` guard the re-entrant call re-adds `"trails"` and throws, on
 * both first load and after `setStyle` (#46, #51).
 */
export function shouldAddReplayMapLayers(opts: {
  isAdding: boolean;
  map: { getSource: (id: string) => unknown };
}): boolean {
  return !opts.isAdding && needsReplayMapLayers(opts.map);
}
