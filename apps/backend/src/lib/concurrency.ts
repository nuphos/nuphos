// Bounded-concurrency helpers shared across the backend.

/** Run async work over items with a bounded concurrency (rate-limit friendly). */
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('mapLimit limit must be a positive integer')
  }
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(fn))
  }
}

/**
 * Like mapLimit but a rolling worker pool: each of `limit` workers pulls the
 * next item as soon as it finishes, so a slow item (e.g. a region that burns the
 * full connect timeout) only ties up one slot instead of stalling a whole batch.
 * Preferred for the region sweep, where item durations vary wildly.
 */
export async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('mapPool limit must be a positive integer')
  }
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const idx = next++
      const item = items[idx]

      if (item === undefined) continue
      await fn(item).catch((err: unknown) => {
        failed = true
        throw err
      })
    }
  }
  // After a failure no worker takes another item, and the pool rejects only once
  // the ones in flight have finished, so nothing it started outlives it.
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  const rejected = settled.find((result) => result.status === 'rejected')

  if (rejected) throw rejected.reason
}
