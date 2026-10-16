import type { DeviceMetrics } from '../../../src/api/device-types.ts'

/** One sampler on this host, leased by the visible devices page over its existing tunnel. */
export function createMetricsLease(
  sample: (() => Promise<DeviceMetrics | null>) | undefined,
  report: (metrics: DeviceMetrics) => void,
) {
  let until = 0
  let nextAt = 0
  let generation = 0
  let pending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = () => {
    clearTimeout(timer)
    timer = undefined
    if (pending || Date.now() >= until || !sample) return
    const wait = nextAt - Date.now()

    if (wait > 0) {
      timer = setTimeout(run, wait)

      return
    }
    pending = true
    const epoch = generation
    const result = Promise.resolve().then(() => {
      if (epoch !== generation || Date.now() >= until) return null
      const reading = sample()

      // The sampler's own cache must expire before the next tick.
      nextAt = Date.now() + 5_000

      return reading
    })

    void result
      .then((metrics) => {
        if (!metrics) nextAt = Date.now() + 5_000
        if (metrics && epoch === generation && Date.now() < until) report(metrics)
      })
      .catch(() => {
        nextAt = Date.now() + 5_000
      })
      .finally(() => {
        pending = false
        if (Date.now() < until) run()
      })
  }

  return {
    renew(leaseMs: number) {
      if (!Number.isFinite(leaseMs)) return
      until = Date.now() + Math.min(12_000, Math.max(0, leaseMs))
      run()
    },
    stop() {
      generation += 1
      until = 0
      clearTimeout(timer)
      timer = undefined
    },
  }
}
