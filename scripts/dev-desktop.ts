// The desktop supervisor: vite + electron under one `pnpm electron:dev`, with
// its readiness read back out of their (colourised) output.
import { spawn } from 'node:child_process'

import { pipeLines, selectCrashDiagnostic, stripAnsi } from './dev-child-output.ts'
import { markDirty, pushEvent } from './dev-event-log.ts'
import { backend, desktop, ensureDeps, openLog, startTiming, writeRaw } from './dev-services.ts'
import { isQuitting, stopTree } from './dev-shutdown.ts'
import { BASE_BACKEND_PORT, DESKTOP_DIR, DEV_CLI_CONFIG, WT_ID } from './dev-workspace.ts'

const SELF_HEAL_FAILURE_THRESHOLD = 3
let selfHealInFlight = false
let selfHealAttempted = false

/** A profile of its own for the local stack, so tabs and teams saved against
 * another backend never load here; every additional backend port gets its own
 * Electron userData directory and single-instance lock on top. */
export function desktopInstanceSuffix(worktreeId: string, backendPort: number): string {
  const local = `${worktreeId} local`

  return backendPort === BASE_BACKEND_PORT ? local : `${local}-${String(backendPort)}`
}

type ElectronBackendHealth = {
  event: 'nuphos.dev.electron_backend_health'
  status: 'healthy' | 'unhealthy'
  consecutiveFailures: number
  latencyMs: number
  error?: string
}

export function parseElectronBackendHealth(line: string): ElectronBackendHealth | null {
  let value: unknown

  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!value || typeof value !== 'object') return null
  const event = value as Partial<ElectronBackendHealth>

  if (
    event.event !== 'nuphos.dev.electron_backend_health' ||
    (event.status !== 'healthy' && event.status !== 'unhealthy') ||
    typeof event.consecutiveFailures !== 'number' ||
    typeof event.latencyMs !== 'number'
  ) {
    return null
  }

  return event as ElectronBackendHealth
}

function handleElectronBackendHealth(health: ElectronBackendHealth): void {
  if (health.status === 'healthy') {
    const recovered = desktop.health.backend?.startsWith('✕')

    desktop.health.backend = `✓ ${String(health.latencyMs)}ms`
    if (desktop.health.electron === '✓') desktop.status = 'ready'
    // A final line from the stale process must not re-arm recovery while that
    // very process is being replaced. The replacement's healthy probe will.
    if (!selfHealInFlight) selfHealAttempted = false
    if (recovered) pushEvent(desktop, 'Electron → backend health recovered')
    markDirty()

    return
  }

  const firstFailure = !desktop.health.backend?.startsWith('✕')

  desktop.health.backend = `✕ ${String(health.consecutiveFailures)}×`
  if (desktop.health.electron === '✓') desktop.status = 'degraded'
  if (firstFailure) {
    pushEvent(
      desktop,
      `Electron → backend health failed: ${health.error?.slice(0, 100) || 'no response'}`,
    )
  }
  markDirty()

  if (health.consecutiveFailures >= SELF_HEAL_FAILURE_THRESHOLD) void selfHealDesktop()
}

export function parseDesktop(raw: string) {
  // vite/electron colorize output under FORCE_COLOR; strip ANSI escapes first so
  // the URL/ready regexes don't capture or mismatch on escape codes.

  const line = stripAnsi(raw)
  const health = parseElectronBackendHealth(line.trim())

  if (health) {
    handleElectronBackendHealth(health)

    return
  }

  if (/VITE\s+v?[\d.]+\s+ready/i.test(line) || /ready in \d+\s*ms/i.test(line)) {
    if (desktop.health.vite !== '✓') {
      desktop.health.vite = '✓'
      pushEvent(desktop, 'vite ready')
    }
  }
  const local = line.match(/Local:\s+(https?:\/\/[^\s]+)/)

  if (local) {
    desktop.url = local[1]
    const p = local[1].match(/:(\d+)/)

    if (p) desktop.port = Number(p[1])
    markDirty()
  }
  if (line.includes('[nuphos-dev] electron window opened') && desktop.health.electron !== '✓') {
    desktop.status = desktop.health.backend?.startsWith('✕') ? 'degraded' : 'ready'
    desktop.health.electron = '✓'
    desktop.readyMs = desktop.startedAt ? Date.now() - desktop.startedAt : null
    pushEvent(desktop, 'electron window opened')
  }
}

async function selfHealDesktop(): Promise<void> {
  if (selfHealInFlight || selfHealAttempted || isQuitting()) return
  selfHealInFlight = true
  selfHealAttempted = true
  try {
    pushEvent(desktop, 'health failed 3× — restarting Desktop once to clear its connection pool')
    const stale = desktop.proc

    // Detach the stale child before signalling it, so its expected exit cannot
    // overwrite the replacement's dashboard state.
    desktop.proc = null
    await stopTree(stale, 4_000)
    desktop.logStream?.end()
    if (!isQuitting()) await startDesktop()
  } finally {
    // eslint-disable-next-line require-atomic-updates -- this function is guarded against concurrent recovery runs
    selfHealInFlight = false
  }
}

export async function startDesktop() {
  if (process.env.NUPHOS_DEV_NO_DESKTOP) {
    desktop.status = 'stopped'
    desktop.health = { disabled: '—' }
    desktop.url = '(desktop disabled)'
    pushEvent(desktop, 'skipped (NUPHOS_DEV_NO_DESKTOP=1)')

    return
  }
  desktop.status = 'starting'
  desktop.health = {}
  desktop.startedAt = null
  desktop.readyMs = null
  desktop.stallNoticed = 0
  desktop.lastRaw = null
  openLog(desktop)
  if (!(await ensureDeps(desktop, DESKTOP_DIR, 'pnpm', 'vite'))) return
  startTiming(desktop)
  pushEvent(desktop, 'starting vite + electron …')
  const backendPort = backend.port ?? BASE_BACKEND_PORT
  const child = spawn('pnpm', ['electron:dev'], {
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      NUPHOS_API_URL: backend.url ?? `http://localhost:${BASE_BACKEND_PORT}`,
      NUPHOS_LAUNCHER_HEALTH: '1',
      NUPHOS_CLI_CONFIG: DEV_CLI_CONFIG,
      ATLAS_WT_BADGE: WT_ID,
      ATLAS_DEV_SUFFIX: desktopInstanceSuffix(WT_ID, backendPort),
      FORCE_COLOR: '1',
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  desktop.proc = child
  const recentOutput: string[] = []
  const onLine = (l: string) => {
    writeRaw(desktop, l)
    const plain = stripAnsi(l).trim()

    if (plain) {
      desktop.lastRaw = plain
      recentOutput.push(plain)
      if (recentOutput.length > 30) recentOutput.shift()
    }
    parseDesktop(l)
  }

  pipeLines(child.stdout, onLine)
  pipeLines(child.stderr, onLine)
  child.on('exit', (code) => {
    if (isQuitting() || desktop.proc !== child) return
    desktop.status = 'crashed'
    const diagnostic = selectCrashDiagnostic(recentOutput)

    if (diagnostic) pushEvent(desktop, `error: ${diagnostic}`)
    pushEvent(desktop, `exited (code ${code}) — press r to restart`)
    markDirty()
  })
}
