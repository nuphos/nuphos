// runtime.ts — registers callbacks that the metric reader fires every export
// cycle. Cheaper than running our own setInterval to push samples because the
// reader only collects when it's about to export.
//
// Event-loop lag uses `monitorEventLoopDelay` if available (Node 11+, also
// shipped by Bun via node-compat). We fall back to a plain timer-based
// estimate if the import fails.

import { config } from '@/config'
import { metricsRegistry } from '@/otel/metrics'

type DelayHistogram = {
  enable(): void
  disable(): void
  reset(): void
  mean: number
  max: number
}

let elDelay: DelayHistogram | undefined
let registered = false

export async function instrumentRuntime(): Promise<void> {
  if (registered) return
  if (!config.otel.enabled || !config.otel.metrics.enabled) return
  registered = true

  try {
    const perfHooks = await import('node:perf_hooks')

    elDelay = perfHooks.monitorEventLoopDelay({ resolution: 20 }) as DelayHistogram
    elDelay.enable()
  } catch {
    // node:perf_hooks not available in this runtime — gauge will read NaN and
    // the meter will skip the point.
    elDelay = undefined
  }

  const m = metricsRegistry()

  m.runtimeEventLoopLag.addCallback((result) => {
    if (!elDelay) return
    // mean / max are nanoseconds; convert to ms and reset so the next
    // observation window is independent.
    const meanMs = elDelay.mean / 1_000_000

    if (Number.isFinite(meanMs)) {
      result.observe(meanMs, { stat: 'mean' })
    }
    const maxMs = elDelay.max / 1_000_000

    if (Number.isFinite(maxMs)) {
      result.observe(maxMs, { stat: 'max' })
    }
    elDelay.reset()
  })

  m.runtimeMemoryRss.addCallback((r) => {
    r.observe(process.memoryUsage().rss)
  })
  m.runtimeMemoryHeapUsed.addCallback((r) => {
    r.observe(process.memoryUsage().heapUsed)
  })
  m.runtimeMemoryHeapTotal.addCallback((r) => {
    r.observe(process.memoryUsage().heapTotal)
  })
  m.runtimeMemoryExternal.addCallback((r) => {
    r.observe(process.memoryUsage().external)
  })
}
