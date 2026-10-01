// The services the launcher supervises, their dashboard state, and the raw
// log file each one streams to. Everything that starts, stops or renders a
// service reads its row from here.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  lstatSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { pipeLines, selectCrashDiagnostic } from './dev-child-output.ts'
import { markDirty, pushEvent } from './dev-event-log.ts'
import { DEV_OPTIONS } from './dev-options.ts'
import { LOG_DIR, WT_ID } from './dev-workspace.ts'

import type { ChildProcess } from 'node:child_process'
import type { WriteStream } from 'node:fs'

export type Status = 'starting' | 'ready' | 'degraded' | 'crashed' | 'stopped'
export type Service = {
  name: 'mongo' | 'rustfs' | 'runtime' | 'managed' | 'backend' | 'desktop' | 'admin' | 'agent'
  status: Status
  port: number | null
  url: string | null
  health: Record<string, string>
  proc: ChildProcess | null
  color: string
  startedAt: number | null
  readyMs: number | null
  logPath: string
  logStream: WriteStream | null
  // Last non-JSON line the child printed. A fatal startup error usually IS
  // plain text, so this is what the stall watchdog shows instead of leaving
  // the row spinning with nothing to go on.
  lastRaw: string | null
  // Stall notices already emitted, so the watchdog reports once per threshold
  // rather than every tick.
  stallNoticed: number
  // Shown in place of the URL while the row waits on something it cannot start without.
  note: string | null
}

function makeService(name: Service['name'], color: string): Service {
  return {
    name,
    status: 'starting',
    port: null,
    url: null,
    health: {},
    proc: null,
    color,
    startedAt: null,
    readyMs: null,
    // Two launchers may run from the same worktree. Keep their streams separate
    // instead of letting the later createWriteStream({ flags: 'w' }) truncate
    // and interleave the first launcher's diagnostics.
    logPath: join(LOG_DIR, `${WT_ID}-${String(process.pid)}-${name}.log`),
    logStream: null,
    lastRaw: null,
    stallNoticed: 0,
    note: null,
  }
}

export const backend = makeService('backend', '\x1b[36m')
export const desktop = makeService('desktop', '\x1b[35m')
export const admin = makeService('admin', '\x1b[35m')
export const mongo = makeService('mongo', '\x1b[32m')
export const rustfs = makeService('rustfs', '\x1b[32m')
export const runtime = makeService('runtime', '\x1b[33m')
export const localAgent = makeService('agent', '\x1b[34m')
export const managed = makeService('managed', '\x1b[33m')
export const frontend = DEV_OPTIONS.mode === 'admin' ? admin : desktop
const stack = DEV_OPTIONS.managed ? [mongo, rustfs, runtime, managed] : [mongo, rustfs, runtime]

export const services =
  DEV_OPTIONS.mode === 'admin'
    ? [...stack, backend, admin]
    : [...stack, backend, desktop, localAgent]

export function startTiming(svc: Service) {
  svc.startedAt = Date.now()
}

export function writeRaw(svc: Service, line: string) {
  if (!svc.logStream) return
  try {
    svc.logStream.write(`${line}\n`)
  } catch {
    /* stream closed during shutdown */
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

/** Remove logs whose launcher owner is gone without touching concurrent runs. */
export function pruneStaleLauncherLogs({
  logDir,
  worktreeId,
  serviceName,
  currentPid,
  isAlive = processIsAlive,
}: {
  logDir: string
  worktreeId: string
  serviceName: Service['name']
  currentPid: number
  isAlive?: (pid: number) => boolean
}): void {
  let names: string[]

  try {
    names = readdirSync(logDir)
  } catch {
    return
  }

  const prefix = `${worktreeId}-`
  const suffix = `-${serviceName}.log`

  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue
    const rawPid = name.slice(prefix.length, -suffix.length)

    if (!/^\d+$/.test(rawPid)) continue
    const ownerPid = Number(rawPid)

    if (ownerPid === currentPid || isAlive(ownerPid)) continue
    try {
      unlinkSync(join(logDir, name))
    } catch {
      /* another launcher may have cleaned it first */
    }
  }
}

export function openLog(svc: Service) {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
  } catch {
    /* exists */
  }
  pruneStaleLauncherLogs({
    logDir: LOG_DIR,
    worktreeId: WT_ID,
    serviceName: svc.name,
    currentPid: process.pid,
  })
  svc.logStream = createWriteStream(svc.logPath, { flags: 'w' })
}

// ─── Dependency preflight ─────────────────────────────────────────────────────
// A fresh worktree has no node_modules, so install with each app's own package
// manager before spawning — the desktop is pnpm-only (bun install is forbidden).
const DEPS_STAMP = '.nuphos-deps-stamp'
const LOCKFILES: Record<'bun' | 'pnpm', string> = { bun: 'bun.lock', pnpm: 'pnpm-lock.yaml' }

/** Hash of the workspace lockfile; each app's lockfile is self-contained. */
export function lockfileDigest(dir: string, tool: 'bun' | 'pnpm'): string {
  const lockfile = join(dir, LOCKFILES[tool])
  const hash = createHash('sha256')

  if (existsSync(lockfile)) hash.update(readFileSync(lockfile))

  return hash.digest('hex')
}

export async function ensureDeps(
  svc: Service,
  dir: string,
  tool: 'bun' | 'pnpm',
  requiredBin?: string,
): Promise<boolean> {
  const stampPath = join(dir, 'node_modules', DEPS_STAMP)
  const digest = lockfileDigest(dir, tool)
  const nodeModulesPresent = existsSync(join(dir, 'node_modules'))
  const requiredBinPresent =
    !requiredBin || existsSync(join(dir, 'node_modules', '.bin', requiredBin))
  const stampFresh = existsSync(stampPath) && readFileSync(stampPath, 'utf8').trim() === digest

  if (nodeModulesPresent && requiredBinPresent && stampFresh) return true
  pushEvent(
    svc,
    !nodeModulesPresent
      ? `node_modules missing — running ${tool} install …`
      : !requiredBinPresent && requiredBin
        ? `dependencies incomplete (${requiredBin} missing) — running ${tool} install …`
        : `lockfile changed since last install — running ${tool} install …`,
  )
  // A borrowed worktree's dependencies must never be purged or stamped here.
  const modulesPath = join(dir, 'node_modules')

  if (lstatSync(modulesPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    unlinkSync(modulesPath)
  }
  const startedAt = Date.now()
  const args = tool === 'pnpm' ? ['install', '--config.confirmModulesPurge=false'] : ['install']
  const child = spawn(tool, args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  const output: string[] = []
  const onLine = (line: string) => {
    writeRaw(svc, line)
    output.push(line)
    if (output.length > 50) output.shift()
  }

  pipeLines(child.stdout, onLine)
  pipeLines(child.stderr, onLine)
  const code = await new Promise<number>((resolve) => {
    child.on('close', (c) => resolve(c ?? 1))
    child.on('error', (error) => {
      onLine(error.message)
      resolve(127)
    })
  })

  if (code === 0) {
    // Stamp what was actually installed, so the next pull that changes a
    // lockfile triggers a reinstall instead of a mid-boot module-not-found.
    try {
      writeFileSync(stampPath, lockfileDigest(dir, tool))
    } catch {
      // Unstamped just means one redundant install next boot.
    }
  }

  if (code !== 0) {
    const diagnostic = selectCrashDiagnostic(output)

    if (diagnostic) pushEvent(svc, diagnostic)
  }

  return reportInstallResult(svc, tool, code, startedAt)
}

function reportInstallResult(
  svc: Service,
  tool: 'bun' | 'pnpm',
  code: number,
  startedAt: number,
): boolean {
  if (code !== 0) {
    svc.status = 'crashed'
    pushEvent(svc, `${tool} install failed (code ${code}) — see raw log, then press r`)
    markDirty()

    return false
  }
  pushEvent(svc, `${tool} install done (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`)

  return true
}
