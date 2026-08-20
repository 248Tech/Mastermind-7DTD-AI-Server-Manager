/** Delete stale Map entries. Returns the number of keys removed. */
export function pruneMap<K, V>(map: Map<K, V>, isFresh: (value: V, key: K) => boolean): number {
  let removed = 0;
  for (const [key, value] of map) {
    if (isFresh(value, key)) continue;
    map.delete(key);
    removed++;
  }
  return removed;
}
