import type { DeviceMetrics } from '../../../src/api/device-types.ts'

/** Samples now and then 5 seconds after each sample settles, so samples never overlap. */
export function reportMetrics(
  sample: (() => Promise<DeviceMetrics | null>) | undefined,
  report: (metrics: DeviceMetrics) => void,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = () =>
    void sample?.()
      .catch(() => null)
      .then((metrics) => {
        if (stopped) return
        if (metrics) report(metrics)
        timer = setTimeout(tick, 5_000)
      })

  tick()

  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
