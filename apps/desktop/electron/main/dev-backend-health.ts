import { isDev } from './env'

const HEALTH_INTERVAL_MS = 5_000
const HEALTH_TIMEOUT_MS = 3_000

type DevBackendHealthEvent = {
  event: 'nuphos.dev.electron_backend_health'
  status: 'healthy' | 'unhealthy'
  consecutiveFailures: number
  latencyMs: number
  error?: string
}

function emit(event: DevBackendHealthEvent): void {
  // The dev launcher consumes this structured line from Electron's stdout.
  console.log(JSON.stringify(event))
}

export function startDevBackendHealthProbe(): void {
  if (!isDev || process.env.NUPHOS_LAUNCHER_HEALTH !== '1') return

  const backendUrl = process.env.NUPHOS_API_URL ?? process.env.ATLAS_API_URL

  if (!backendUrl) return

  const healthUrl = new URL('/health', backendUrl).toString()
  let consecutiveFailures = 0
  let lastStatus: DevBackendHealthEvent['status'] | null = null
  let probeInFlight = false

  const probe = async () => {
    if (probeInFlight) return
    probeInFlight = true
    const startedAt = Date.now()

    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      })

      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      consecutiveFailures = 0
      if (lastStatus !== 'healthy') {
        emit({
          event: 'nuphos.dev.electron_backend_health',
          status: 'healthy',
          consecutiveFailures,
          latencyMs: Date.now() - startedAt,
        })
      }
      lastStatus = 'healthy'
    } catch (error) {
      consecutiveFailures += 1
      lastStatus = 'unhealthy'
      emit({
        event: 'nuphos.dev.electron_backend_health',
        status: 'unhealthy',
        consecutiveFailures,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      // eslint-disable-next-line require-atomic-updates -- the in-flight guard has one timer-owned writer
      probeInFlight = false
    }
  }

  void probe()
  const timer = setInterval(() => void probe(), HEALTH_INTERVAL_MS)

  timer.unref()
}
