// Samples every active runtime on a fixed cadence. Each runtime reports its own
// usage over the operator channel, wherever it runs.
// Rows are keyed by (runtime, interval bucket), so replicas sampling the same
// runtime write the same document rather than doubling the series.
import { logError } from '@/lib/observability'

import { sampleExternalRuntimeMetrics } from './runtime-external-metrics'
import { RUNTIME_METRIC_SAMPLE_INTERVAL_MS, sampleBucket } from './runtime-metrics-store'

const samplerGlobal = globalThis as typeof globalThis & {
  nuphosRuntimeMetricsSampler?: { timer: ReturnType<typeof setInterval>; running: boolean }
}

export async function sampleRuntimeMetrics(nowMs = Date.now()): Promise<void> {
  await sampleExternalRuntimeMetrics(sampleBucket(nowMs), nowMs)
}

export function initRuntimeMetricsSampler(): void {
  shutdownRuntimeMetricsSampler()
  const state = { timer: undefined as unknown as ReturnType<typeof setInterval>, running: false }
  const tick = async () => {
    if (state.running) return
    state.running = true
    try {
      await sampleRuntimeMetrics()
    } catch (err) {
      logError('openab.metrics.sample_failed', err)
    } finally {
      state.running = false
    }
  }

  state.timer = setInterval(() => void tick(), RUNTIME_METRIC_SAMPLE_INTERVAL_MS)
  samplerGlobal.nuphosRuntimeMetricsSampler = state
  void tick()
}

export function shutdownRuntimeMetricsSampler(): void {
  const state = samplerGlobal.nuphosRuntimeMetricsSampler

  if (!state) return
  clearInterval(state.timer)
  delete samplerGlobal.nuphosRuntimeMetricsSampler
}
