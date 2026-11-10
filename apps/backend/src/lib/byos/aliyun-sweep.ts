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
