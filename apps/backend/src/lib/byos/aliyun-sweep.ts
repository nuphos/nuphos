/**
 * Regions probed at once during an instance sweep. High enough that live regions
 * don't queue behind dead/blocked ones (which each cost a full connect timeout),
 * but bounded so a healthy account doesn't fan out to dozens of calls. Aliyun's
 * read APIs tolerate this; throttling is handled by withAliyunRateLimitRetry.
 */
export const REGION_SCAN_CONCURRENCY = 12

/**
 * Pages fetched at once WITHIN a region. Instance lists page 100 at a time; a
 * region with hundreds of instances would otherwise page sequentially (the main
 * cost for large accounts). Page 1 yields totalCount, then the rest fan out.
 */
export const PAGE_SCAN_CONCURRENCY = 8

/**
 * Overall wall-clock budget for a region sweep — a safety net for a pathological
 * hang, not the common path. With the rolling region pool + parallel pagination
 * a large account (~1300 instances) completes in well under 10s; this only fires
 * if something is badly stuck, returning partial results instead of hanging. The
 * desktop's list-call timeout is set comfortably above this. See withSweepDeadline.
 */
export const REGION_SWEEP_DEADLINE_MS = 25_000

/** Per-region client timeouts. Short connect so a dead/hung endpoint fails fast. */
export const SWEEP_CONNECT_TIMEOUT_MS = 5_000
export const SWEEP_READ_TIMEOUT_MS = 20_000

/**
 * Await `work`, but give up after `ms` and resolve `'deadline'` instead. Never
 * rejects. Callers accumulate results in closure arrays, so returning early
 * yields whatever regions finished in time (partial results) rather than a hard
 * client-side timeout. The abandoned work keeps running to completion in the
 * background but its results are ignored — each region task swallows its own
 * errors, so there is no unhandled rejection.
 */
export async function withSweepDeadline(
  work: Promise<void>,
  ms: number,
): Promise<'done' | 'deadline'> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => {
      resolve('deadline')
    }, ms)
  })

  try {
    return await Promise.race([work.then(() => 'done' as const), deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

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
  const worker = async () => {
    while (next < items.length) {
      const idx = next++
      const item = items[idx]

      if (item === undefined) continue
      await fn(item)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}
