// Remote agent sandboxes fetch credentials from the backend by URL, so a local
// backend needs a public URL or sandbox-side setup silently hits PROD. Prefers
// this machine's stable named tunnel; falls back to a per-run quick tunnel.
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { pushEvent } from './dev-event-log.ts'
import { signalGroup } from './dev-shutdown.ts'
import { LOG_DIR } from './dev-workspace.ts'

import type { ChildProcess } from 'node:child_process'

type TunnelStatus = 'off' | 'starting' | 'ready' | 'missing' | 'error'
export const tunnel = {
  name: 'tunnel',
  color: '\x1b[34m',
  status: 'off' as TunnelStatus,
  url: null as string | null,
  kind: null as 'named' | 'quick' | null,
  proc: null as ChildProcess | null,
  note: '',
}
const NAMED_TUNNEL_LO = 3718
const NAMED_TUNNEL_HI = 3722

function hasCloudflared(): boolean {
  return Boolean(Bun.which('cloudflared'))
}
function machineHasNamedTunnel(): boolean {
  try {
    const p = Bun.spawnSync(['cloudflared', 'tunnel', 'list'])

    return p.success && p.stdout.toString().includes('nuphos-local-dev')
  } catch {
    return false
  }
}
function namedTunnelRunning(): boolean {
  try {
    return Bun.spawnSync(['pgrep', '-f', 'cloudflared tunnel --config']).success
  } catch {
    return false
  }
}

// The named tunnel serves every worktree, so it is spawned detached + unref'd.
// --protocol http2: the default QUIC dies silently under proxies/VPNs while
// the pid stays alive.
const NAMED_TUNNEL_LOG = join(LOG_DIR, 'named-tunnel.log')
const NAMED_TUNNEL_CONFIG = join(homedir(), '.cloudflared/config.yml')

let ownNamedTunnel: ChildProcess | null = null
let spawnedNamedTunnel = false

function spawnNamedTunnel() {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
  } catch {
    /* exists */
  }
  const out = openSync(NAMED_TUNNEL_LOG, 'a')
  const child = spawn(
    'cloudflared',
    [
      'tunnel',
      '--config',
      NAMED_TUNNEL_CONFIG,
      '--edge-ip-version',
      '4',
      '--protocol',
      'http2',
      '--no-autoupdate',
      'run',
      'nuphos-local-dev',
    ],
    { detached: true, stdio: ['ignore', out, out] },
  )

  child.unref()
  closeSync(out)
  ownNamedTunnel = child
  spawnedNamedTunnel = true
  child.once('exit', () => {
    if (ownNamedTunnel === child) ownNamedTunnel = null
  })
}

// A live pid is NOT a live tunnel: cloudflared can lose every edge connection
// and keep running. Cloudflare answers 530 for an unregistered tunnel; any
// other status (even 502 while the origin boots) proves the edge reached us.
async function tunnelEdgeAlive(url: string): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    try {
      // A configured ingress returns 200 (or 502 while booting); the catch-all
      // returns 404, so probing the old root could accept an unusable hostname.
      const res = await fetch(new URL('/openapi.json', url), {
        signal: AbortSignal.timeout(3000),
      })

      if (res.status !== 530 && res.status !== 404) return true
    } catch {
      /* transient network error — retry */
    }
    await Bun.sleep(1000)
  }

  return false
}

/** Resolve the public hostname whose ingress service targets this worktree's
 * backend port. Read the installed config instead of assuming a hostname
 * convention; named tunnel hostnames have changed over time. */
export function namedTunnelUrlFromConfig(source: string, port: number): string | null {
  let hostname: string | null = null

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    const hostnameMatch = line.match(/^- hostname:\s*(\S+)$/)

    if (hostnameMatch) {
      hostname = hostnameMatch[1] ?? null
      continue
    }
    if (line.startsWith('- ') && !line.startsWith('- hostname:')) hostname = null
    if (hostname && /^service:\s*http:\/\//.test(line) && line.includes(`:${String(port)}`)) {
      return `https://${hostname}`
    }
  }

  return null
}

function configuredNamedTunnelUrl(port: number): string | null {
  try {
    return namedTunnelUrlFromConfig(readFileSync(NAMED_TUNNEL_CONFIG, 'utf8'), port)
  } catch {
    return null
  }
}

async function ensureNamedTunnel(): Promise<boolean> {
  if (!namedTunnelRunning()) spawnNamedTunnel()
  if (await tunnelEdgeAlive(tunnel.url!)) return true
  pushEvent(tunnel, 'edge returns 530 (pid alive ≠ tunnel alive) — restarting cloudflared…')
  try {
    Bun.spawnSync(['pkill', '-f', 'cloudflared tunnel --config'])
  } catch {
    /* nothing to kill */
  }
  spawnNamedTunnel()

  return tunnelEdgeAlive(tunnel.url!)
}

async function startQuickTunnel(port: number): Promise<string | null> {
  tunnel.kind = 'quick'
  tunnel.status = 'starting'
  tunnel.note = 'starting…'
  pushEvent(tunnel, 'starting quick tunnel (trycloudflare)…')
  const child = spawn(
    'cloudflared',
    ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate', '--no-prechecks'],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  tunnel.proc = child
  const url = await new Promise<string | null>((resolve) => {
    let settled = false
    const finish = (v: string | null) => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    const onData = (chunk: Buffer) => {
      const m = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)

      if (m) finish(m[0])
    }

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    setTimeout(() => finish(null), 20_000)
  })

  applyQuickTunnelResult(url)

  return url
}

function applyQuickTunnelResult(url: string | null) {
  if (url) {
    tunnel.url = url
    tunnel.status = 'ready'
    tunnel.note = 'quick'
    pushEvent(tunnel, `ready → ${url}`)
  } else {
    tunnel.status = 'error'
    tunnel.note = 'timed out — sandbox → PROD'
    pushEvent(tunnel, 'quick tunnel timed out — sandbox callbacks hit PROD')
  }
}

// Bring up the tunnel for `port` and return the public URL to hand the backend
// as NUPHOS_BACKEND_URL. Returns null when unavailable (backend still starts,
// but sandbox callbacks fall back to PROD — surfaced loudly on the dashboard).
export async function setupTunnel(port: number): Promise<string | null> {
  stopTunnel() // drop any quick tunnel from a previous (port-conflict) attempt
  if (!hasCloudflared()) {
    tunnel.status = 'missing'
    tunnel.kind = null
    tunnel.url = null
    tunnel.note = '`brew install cloudflared` — sandbox → PROD'
    pushEvent(tunnel, 'cloudflared not installed — `brew install cloudflared` (sandbox → PROD)')

    return null
  }
  if (port >= NAMED_TUNNEL_LO && port <= NAMED_TUNNEL_HI && machineHasNamedTunnel()) {
    const configuredUrl = configuredNamedTunnelUrl(port)

    if (!configuredUrl) {
      pushEvent(tunnel, `named tunnel has no ingress for :${String(port)} — using quick tunnel`)

      return startQuickTunnel(port)
    }
    tunnel.kind = 'named'
    tunnel.url = configuredUrl
    tunnel.status = 'starting'
    tunnel.note = 'named — verifying edge…'
    if (await ensureNamedTunnel()) {
      tunnel.status = 'ready'
      tunnel.note = 'named'
      pushEvent(tunnel, `ready → ${tunnel.url} (edge verified)`)

      return tunnel.url
    }
    tunnel.status = 'error'
    tunnel.note = '530 at edge — see named-tunnel.log'
    pushEvent(
      tunnel,
      `named tunnel unreachable at edge (530) — sandbox → PROD; log: ${NAMED_TUNNEL_LOG}`,
    )

    return null
  }

  return startQuickTunnel(port)
}

// Kill only a quick tunnel we own; the named tunnel is shared infra, left alone.
export function stopTunnel() {
  if (tunnel.kind === 'quick' && tunnel.proc) {
    signalGroup(tunnel.proc, 'SIGTERM')
    tunnel.proc = null
  }
}

export function tunnelOwnership(): 'none' | 'quick' | 'named-ours' | 'named-theirs' {
  if (tunnel.kind === 'quick') return tunnel.proc ? 'quick' : 'none'
  if (tunnel.kind !== 'named') return 'none'

  if (ownNamedTunnel) return 'named-ours'

  return spawnedNamedTunnel ? 'none' : 'named-theirs'
}

export function stopOwnNamedTunnel() {
  signalGroup(ownNamedTunnel, 'SIGTERM')
  ownNamedTunnel = null
}
