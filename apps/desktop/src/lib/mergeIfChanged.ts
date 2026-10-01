/**
 * Merge `next` under `key` only when its value actually differs.
 *
 * A refetch returns freshly-deserialized data, so the value is a new object
 * even when the server sent exactly what we already had. Storing it anyway
 * changes the map's identity, and everything keyed on it — in practice a full
 * App re-render — runs again for nothing. Keeping the previous map when the
 * values match turns a no-change refetch into a no-op.
 */
export function mergeIfChanged<T>(
  prev: Record<string, T>,
  key: string,
  next: T,
): Record<string, T> {
  return JSON.stringify(prev[key]) === JSON.stringify(next) ? prev : { ...prev, [key]: next }
}
