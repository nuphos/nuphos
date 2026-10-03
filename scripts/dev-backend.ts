// The backend supervisor: parse its log stream into dashboard state, and spawn
// it (detached → own process group) on the local docker compose stack.
import { execSync, spawn } from 'node:child_process'
import { existsSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { backendEnv } from './dev-backend-env.ts'
import { ANSI_COLOR, pipeLines, stripAnsi } from './dev-child-output.ts'
import { markDirty, pushEvent } from './dev-event-log.ts'
import { localBackendEnv } from './dev-local-stack-env.ts'
import { managedBackendEnv } from './dev-managed-env.ts'
import { findFreePort, releasePort } from './dev-ports.ts'
import { backend, ensureDeps, openLog, startTiming, writeRaw } from './dev-services.ts'
import { isQuitting } from './dev-shutdown.ts'
import { setupTunnel } from './dev-tunnel.ts'
import { BACKEND_DIR, BASE_BACKEND_PORT, ROOT } from './dev-workspace.ts'

import type { LocalStack } from './dev-local-stack-env.ts'

// Port-race recovery: if a parallel worktree grabbed our chosen port between
// probe and bind, the backend exits EADDRINUSE — we pick a fresh port and retry.
let backendPortConflict = false
let backendRetries = 0
const MAX_BACKEND_RETRIES = 8

export function resetBackendRetries() {
  backendRetries = 0
}

// Plain-text output that means the process will never finish starting: `bun
// run --hot` does NOT exit on these — it prints the error and idles waiting
// for a file change, so unsurfaced the dashboard would spin forever.
const FATAL_LINE =
  /(Cannot find module|SyntaxError|ReferenceError|is not configured|EADDRINUSE|error: )/

export function parseBackend(line: string) {
  if (line.includes('EADDRINUSE')) backendPortConflict = true
  // A module-level throw produces no exit event under --hot, so surface the
  // `error: ` line as a milestone rather than leaving it buried in the raw log.
  const clean = line.replace(ANSI_COLOR, '')

  if (backend.status === 'starting' && /^error: /.test(clean)) {
    backend.status = 'crashed'
    pushEvent(backend, `${clean.trim()} — fix, then press r (--hot keeps the dead process alive)`)
  }
  let j: Record<string, unknown>

  try {
    j = JSON.parse(line) as Record<string, unknown>
  } catch {
    parsePlainBackendLine(line)

    return
  }
  handleBackendEvent(j)
}

function parsePlainBackendLine(line: string) {
  const plain = stripAnsi(line).trim()

  if (!plain) return
  backend.lastRaw = plain
  // Only meaningful while still starting; catches fatal output the crash
  // handler above does not recognise, without reporting the same line twice.
  if (backend.status === 'starting' && FATAL_LINE.test(plain)) {
    backend.status = 'crashed'
    pushEvent(backend, plain.slice(0, 200))
    markDirty()
  }
}

function handleServerListening(j: Record<string, unknown>) {
  backend.status = 'ready'
  if (typeof j.port === 'number') {
    backend.port = j.port
    backend.url = `http://localhost:${j.port}`
  }
  backend.readyMs = backend.startedAt ? Date.now() - backend.startedAt : null
  const readyIn =
    backend.readyMs == null ? '' : `  (ready in ${(backend.readyMs / 1000).toFixed(1)}s)`

  pushEvent(backend, `listening on :${backend.port}${readyIn}`)
}

function handleBackendEvent(j: Record<string, unknown>) {
  const event = typeof j.event === 'string' ? j.event : ''

  switch (event) {
    case 'backend.mongodb.connected':
      backend.health.mongo = '✓'
      backend.health.indexes = 'building…'
      pushEvent(backend, 'mongo connected')
      break
    case 'auth.email_otp.dev_code':
      pushEvent(backend, `sign-in code for ${String(j.email)}: ${String(j.sign_in_code)}`)
      break
    case 'backend.server.listening':
      handleServerListening(j)
      break
    case 'backend.mongodb.indexes_ready': {
      backend.health.indexes = '✓'
      const took = typeof j.ms === 'number' ? `, ${(j.ms / 1000).toFixed(1)}s` : ''

      pushEvent(backend, `indexes ready (background${took})`)
      break
    }
    case 'backend.mongodb.index_setup_failed':
      backend.health.indexes = '✕'
      pushEvent(backend, 'index build failed — see log file')
      break
    // Chat-level stalls aren't a backend health problem, but they're exactly
    // what someone staring at an all-green dashboard is trying to debug.
    case 'agent.chat.pump.model_stream_silence_paused':
      pushEvent(
        backend,
        'agent model stream silent >60s — upstream stall (Bedrock reachability / proxy buffering); chat pauses on "Continuing…"',
      )
      break
    case 'agent.chat.stream.error': {
      const msg =
        typeof j.error_message === 'string' ? j.error_message.slice(0, 120) : 'see log file'

      pushEvent(backend, `agent stream error: ${msg}`)
      break
    }
    default:
      if (event.startsWith('backend.') && event.endsWith('.ready')) {
        pushEvent(backend, `${event.replace(/^backend\./, '').replace(/\.ready$/, '')} ready`)
      }
  }
}

// A fresh worktree lacks apps/backend/.env, so symlink the main checkout's
// shared .env. Never overwrites an existing file/symlink — the user may have
// customised theirs.
export function ensureBackendEnv(): void {
  const envPath = join(BACKEND_DIR, '.env')

  if (existsSync(envPath)) return
  // In a linked worktree, --git-common-dir points at the main checkout's .git.
  let mainRoot = ROOT

  try {
    const common = execSync('git rev-parse --path-format=absolute --git-common-dir', {
      cwd: ROOT,
    })
      .toString()
      .trim()

    mainRoot = dirname(common)
  } catch {
    /* not a git checkout — fall back to ROOT */
  }
  const shared = join(mainRoot, '.env')

  if (!existsSync(shared)) {
    pushEvent(backend, `no shared .env at ${shared} — create apps/backend/.env by hand`)

    return
  }
  symlinkSync(shared, envPath)
  pushEvent(backend, `symlinked apps/backend/.env → ${shared}`)
}

function assignBackendPort(port: number) {
  backend.port = port
  backend.url = `http://localhost:${port}`
  pushEvent(backend, `starting on :${port} …`)
}

/** `managedContext` is the verified local kube context the provisioner deploys into, or null to keep it off. */
export async function startBackend(local: LocalStack, managedContext: string | null = null) {
  backend.status = 'starting'
  backend.health = {}
  backendPortConflict = false
  backend.startedAt = null
  backend.readyMs = null
  openLog(backend)
  if (!(await ensureDeps(backend, BACKEND_DIR, 'bun'))) return
  // Timed from here, not from entry: a fresh worktree's install can outlast the
  // stall thresholds on its own and would be reported as a hung backend.
  startTiming(backend)
  ensureBackendEnv()
  // On a retry, probe *above* the port that was taken so we skip past whichever
  // parallel worktree grabbed it.
  const probeFrom = backendRetries > 0 && backend.port ? backend.port + 1 : BASE_BACKEND_PORT

  if (backend.port) releasePort(backend.port) // give up the port that was taken
  assignBackendPort(await findFreePort(probeFrom))
  const baseEnv = backendEnv()
  // Self-hosted runtimes and remote sandboxes need a public URL for *this*
  // backend, never PROD. Named tunnels resolve instantly; a quick tunnel adds a
  // few seconds while its URL is minted.
  const tunnelUrl = await setupTunnel(backend.port)
  const child = spawn('bun', ['run', 'dev'], {
    cwd: BACKEND_DIR,
    env: {
      ...baseEnv,
      ...localBackendEnv(local),
      ...(managedContext ? managedBackendEnv(managedContext) : {}),
      PORT: String(backend.port),
      NUPHOS_DEV_LAUNCHER_PID: String(process.pid),
      FORCE_COLOR: '1',
      NUPHOS_BACKEND_URL: `http://host.docker.internal:${String(backend.port)}`,
      NUPHOS_PUBLIC_BACKEND_URL: tunnelUrl ?? '',
    },
    detached: true, // new process group so quit() can kill the whole tree
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  backend.stallNoticed = 0
  backend.lastRaw = null
  backend.proc = child
  const onLine = (l: string) => {
    writeRaw(backend, l)
    parseBackend(l)
  }

  pipeLines(child.stdout, onLine)
  pipeLines(child.stderr, onLine)
  child.on('exit', (code) => {
    // Ignore a superseded child's late exit — restartAll / the port-conflict
    // retry may have already swapped backend.proc to a fresh, healthy process.
    if (isQuitting() || backend.proc !== child) return
    backend.status = 'crashed'
    if (backendPortConflict && backendRetries < MAX_BACKEND_RETRIES) {
      backendRetries++
      pushEvent(
        backend,
        `port taken by another worktree — retrying on a new port (${backendRetries}/${MAX_BACKEND_RETRIES})…`,
      )
      void startBackend(local, managedContext)
    } else {
      pushEvent(backend, `exited (code ${code}) — press r to restart`)
    }
    markDirty()
  })
}
