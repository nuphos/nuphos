// HTTPS Next.js supervisor, wired to this launcher's backend. It owns the
// one-time preflights the old Admin skill performed so `bun run dev --admin`
// is a complete stack rather than a bare command with four required env vars.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'

import { pipeLines, stripAnsi } from './dev-child-output.ts'
import { markDirty, pushEvent } from './dev-event-log.ts'
import { findFreePort, releasePort } from './dev-ports.ts'
import { admin, backend, ensureDeps, openLog, startTiming, writeRaw } from './dev-services.ts'
import { isQuitting } from './dev-shutdown.ts'
import {
  ADMIN_DIR,
  BACKEND_DIR,
  BASE_ADMIN_PORT,
  BASE_BACKEND_PORT,
  MKCERT_CA,
} from './dev-workspace.ts'

type AdminTls = { cert: string; key: string }

function unquote(value: string): string {
  const trimmed = value.trim()

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

export function envValue(contents: string, name: string): string | null {
  const line = contents
    .split('\n')
    .find((candidate) => candidate.trimStart().startsWith(`${name}=`))

  return line ? unquote(line.slice(line.indexOf('=') + 1)) : null
}

export function hostsLocalAdmin(contents: string): boolean {
  return contents.split('\n').some((line) => {
    const active = line.split('#', 1)[0]?.trim()

    if (!active) return false
    const [, ...hosts] = active.split(/\s+/)

    return hosts.includes('local.nuphos.ai')
  })
}

function expandHome(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  if (value.startsWith('$HOME/')) return join(homedir(), value.slice('$HOME/'.length))

  return value
}

function adminTlsPaths(): AdminTls | null {
  let contents: string

  try {
    contents = readFileSync(join(BACKEND_DIR, '.env'), 'utf8')
  } catch {
    pushEvent(admin, 'apps/backend/.env missing — cannot locate the local TLS directory')

    return null
  }
  const backendCertValue = envValue(contents, 'ATLAS_DEV_TLS_CERT')

  if (!backendCertValue) {
    pushEvent(admin, 'ATLAS_DEV_TLS_CERT missing from apps/backend/.env')

    return null
  }
  const expanded = expandHome(backendCertValue)
  const backendCert = isAbsolute(expanded) ? expanded : join(BACKEND_DIR, expanded)
  const certDir = dirname(backendCert)

  return {
    cert: join(certDir, 'local.nuphos.ai.pem'),
    key: join(certDir, 'local.nuphos.ai-key.pem'),
  }
}

async function runMkcert(tls: AdminTls): Promise<boolean> {
  pushEvent(admin, 'generating local.nuphos.ai TLS certificate …')
  const child = spawn('mkcert', ['-cert-file', tls.cert, '-key-file', tls.key, 'local.nuphos.ai'], {
    cwd: dirname(tls.cert),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  pipeLines(child.stdout, (line) => writeRaw(admin, line))
  pipeLines(child.stderr, (line) => writeRaw(admin, line))
  const code = await new Promise<number>((resolve) => {
    child.once('exit', (value) => resolve(value ?? 1))
    child.once('error', () => resolve(127))
  })

  if (code === 0 && existsSync(tls.cert) && existsSync(tls.key)) return true
  pushEvent(admin, `mkcert failed (code ${code}) — install mkcert and run mkcert -install`)

  return false
}

async function ensureAdminTls(): Promise<AdminTls | null> {
  if (!existsSync(MKCERT_CA)) {
    pushEvent(admin, `mkcert root CA missing at ${MKCERT_CA} — run mkcert -install`)

    return null
  }
  const tls = adminTlsPaths()

  if (!tls) return null
  if ((existsSync(tls.cert) && existsSync(tls.key)) || (await runMkcert(tls))) return tls

  return null
}

function parseAdmin(line: string) {
  const plain = stripAnsi(line).trim()

  if (!plain) return
  admin.lastRaw = plain
  if (/Ready in|ready in/i.test(plain) && admin.status !== 'ready') {
    admin.status = 'ready'
    admin.health.next = '✓'
    admin.readyMs = admin.startedAt ? Date.now() - admin.startedAt : null
    pushEvent(admin, `ready on :${admin.port}`)
    markDirty()

    return
  }
  if (admin.status === 'starting' && /(EADDRINUSE|error:|failed)/i.test(plain)) {
    admin.status = 'crashed'
    pushEvent(admin, plain.slice(0, 200))
    markDirty()
  }
}

export async function startAdmin() {
  admin.status = 'starting'
  admin.health = {}
  admin.startedAt = null
  admin.readyMs = null
  admin.stallNoticed = 0
  admin.lastRaw = null
  openLog(admin)
  if (!(await ensureDeps(admin, ADMIN_DIR, 'bun', 'next'))) return
  let hosts: string

  try {
    hosts = readFileSync('/etc/hosts', 'utf8')
  } catch {
    hosts = ''
  }
  if (!hostsLocalAdmin(hosts)) {
    admin.health.hosts = '✕'
    pushEvent(admin, 'local.nuphos.ai missing from /etc/hosts — add: 127.0.0.1 local.nuphos.ai')
  } else admin.health.hosts = '✓'
  const tls = await ensureAdminTls()

  if (!tls) {
    admin.status = 'crashed'
    markDirty()

    return
  }
  if (admin.port) releasePort(admin.port)
  admin.port = await findFreePort(BASE_ADMIN_PORT)
  admin.url = `https://local.nuphos.ai:${admin.port}`
  startTiming(admin)
  pushEvent(admin, `starting Next.js on :${admin.port} …`)
  const child = spawn('bun', ['run', 'dev'], {
    cwd: ADMIN_DIR,
    env: {
      ...process.env,
      ADMIN_PORT: String(admin.port),
      ATLAS_ADMIN_BACKEND_URL: backend.url ?? `https://local.zeabur.com:${BASE_BACKEND_PORT}`,
      ATLAS_DEV_TLS_CERT: tls.cert,
      ATLAS_DEV_TLS_KEY: tls.key,
      NODE_EXTRA_CA_CERTS: MKCERT_CA,
      FORCE_COLOR: '1',
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  admin.proc = child
  const onLine = (line: string) => {
    writeRaw(admin, line)
    parseAdmin(line)
  }

  pipeLines(child.stdout, onLine)
  pipeLines(child.stderr, onLine)
  child.on('exit', (code) => {
    if (isQuitting() || admin.proc !== child) return
    admin.status = 'crashed'
    pushEvent(admin, `exited (code ${code}) — press r to restart`)
    markDirty()
  })
}
