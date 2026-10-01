// The agent row: stages the Local agent bundle (openab + adapters) the desktop
// runs, when this checkout's prepare.mjs has not staged it for this computer yet.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { bundleState } from '../apps/desktop/local-runtime/bundle-stamp.mjs'

import { pipeLines, stripAnsi } from './dev-child-output.ts'
import { markDirty, pushEvent } from './dev-event-log.ts'
import { localAgent, openLog, writeRaw } from './dev-services.ts'
import { isQuitting } from './dev-shutdown.ts'
import { DESKTOP_DIR } from './dev-workspace.ts'

import type { Service } from './dev-services.ts'

export const PREPARE_COMMAND = 'node apps/desktop/local-runtime/prepare.mjs'

export type AgentPhase =
  | { kind: 'checking' }
  | { kind: 'ready'; seconds?: number }
  | { kind: 'preparing'; why: 'missing' | 'stale' }
  | { kind: 'failed'; reason: string }
  | { kind: 'missing-tools'; tools: string[] }

const TOOLS: Record<string, string> = {
  cargo: 'Rust toolchain (https://rustup.rs)',
  git: 'git',
  npm: 'npm',
}

export function hostTarget(): string {
  return `${process.platform}-${process.arch}`
}

export function bundleDir(desktopDir: string, target = hostTarget()): string {
  return join(desktopDir, 'build', 'local-runtime', target)
}

/** Read by the desktop to tell a developer why its Local agent is not there yet. */
export function devStatusPath(dir: string): string {
  return `${dir}.dev.json`
}

/** cargo and git only build openab; NUPHOS_OPENAB_BINARY hands prepare.mjs a prebuilt one. */
export function missingTools(
  has: (command: string) => boolean,
  prebuiltOpenab = Boolean(process.env.NUPHOS_OPENAB_BINARY),
): string[] {
  return Object.keys(TOOLS)
    .filter((command) => !(prebuiltOpenab && command !== 'npm') && !has(command))
    .map((command) => TOOLS[command]!)
}

function onPath(command: string): boolean {
  try {
    execFileSync(command, ['--version'], { stdio: 'ignore' })

    return true
  } catch {
    return false
  }
}

/** The line that says why prepare.mjs gave up, else its last words. */
export function failureReason(lines: readonly string[], exitCode: number): string {
  const plain = lines.map((line) => stripAnsi(line).trim()).filter(Boolean)
  const error = plain.findLast((line) => /\berror\b/iu.test(line))

  return (error ?? plain.at(-1) ?? `prepare.mjs exited with code ${String(exitCode)}`).slice(0, 160)
}

export function agentRow(phase: AgentPhase): Pick<Service, 'status' | 'note' | 'health'> {
  switch (phase.kind) {
    case 'checking':
      return { status: 'starting', note: 'checking the local agent bundle…', health: {} }
    case 'ready': {
      const took = phase.seconds == null ? '' : ` (prepared in ${String(phase.seconds)}s)`

      return { status: 'ready', note: `local agent ready${took}`, health: {} }
    }
    case 'preparing':
      return {
        status: 'starting',
        note: `preparing the local agent… (${phase.why === 'stale' ? 'pins changed' : 'first build takes a few minutes'})`,
        health: {},
      }
    case 'failed':
      return {
        status: 'crashed',
        note: 'local agent failed to prepare — press r to retry',
        health: { reason: phase.reason },
      }
    case 'missing-tools':
      return {
        status: 'degraded',
        note: 'local agent unavailable — missing build tools',
        health: { install: `${phase.tools.join(', ')}, then press r` },
      }
  }
}

function writeDevStatus(dir: string, status: object | null): void {
  const path = devStatusPath(dir)

  try {
    if (!status) return rmSync(path, { force: true })
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ pid: process.pid, ...status }))
  } catch {
    // Only improves the desktop's wording.
  }
}

function show(phase: AgentPhase): void {
  Object.assign(localAgent, agentRow(phase))
  markDirty()
}

function runPrepare(dir: string): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = []
  const child = spawn(
    'node',
    ['local-runtime/prepare.mjs', '--targets', hostTarget(), '--require'],
    {
      cwd: DESKTOP_DIR,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const onLine = (line: string) => {
    writeRaw(localAgent, line)
    lines.push(line)
    if (lines.length > 40) lines.shift()
    localAgent.lastRaw = stripAnsi(line).trim() || localAgent.lastRaw
  }

  localAgent.proc = child
  writeDevStatus(dir, { state: 'preparing' })
  pipeLines(child.stdout, onLine)
  pipeLines(child.stderr, onLine)

  return new Promise((resolve) => {
    child.on('error', (error) => {
      lines.push(`Error: ${error.message}`)
    })
    child.on('close', (code) => {
      if (localAgent.proc === child) localAgent.proc = null
      resolve({ code: code ?? 1, lines })
    })
  })
}

/** Never blocks the launcher: the desktop picks the bundle up once its manifest lands. */
export async function startLocalAgent(): Promise<void> {
  if (localAgent.proc) return
  const dir = bundleDir(DESKTOP_DIR)

  show({ kind: 'checking' })
  const state = bundleState(dir)

  if (state === 'ready') {
    writeDevStatus(dir, null)

    return show({ kind: 'ready' })
  }
  const tools = missingTools(onPath)

  if (tools.length) {
    writeDevStatus(dir, { state: 'failed', reason: `Install ${tools.join(', ')}` })
    pushEvent(localAgent, `cannot build the local agent: install ${tools.join(', ')}`)

    return show({ kind: 'missing-tools', tools })
  }
  openLog(localAgent)
  pushEvent(
    localAgent,
    `${state === 'stale' ? 'bundle is stale' : 'no bundle'} — running ${PREPARE_COMMAND}`,
  )
  show({ kind: 'preparing', why: state })
  const startedAt = Date.now()
  const { code, lines } = await runPrepare(dir)

  if (isQuitting()) return writeDevStatus(dir, null)
  if (code === 0 && bundleState(dir) === 'ready') {
    writeDevStatus(dir, null)
    pushEvent(localAgent, 'local agent ready — the desktop picks it up on its own')

    return show({ kind: 'ready', seconds: Math.round((Date.now() - startedAt) / 1000) })
  }
  const reason = failureReason(lines, code)

  writeDevStatus(dir, { state: 'failed', reason })
  pushEvent(localAgent, `prepare failed: ${reason}`)
  show({ kind: 'failed', reason })
}
