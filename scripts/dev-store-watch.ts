// Follows mongo and rustfs container health after `compose up` until both are
// healthy, so a slow or self-restarting store recovers without a relaunch.
import { stripAnsi } from './dev-child-output.ts'
import { COMPOSE, COMPOSE_DIR } from './dev-compose.ts'
import { markDirty, pushEvent } from './dev-event-log.ts'
import { runDevCommand } from './dev-process.ts'
import { backend, frontend, runtime } from './dev-services.ts'
import { isQuitting } from './dev-shutdown.ts'
import { errorTail } from './dev-stack-state.ts'
import {
  blockedNote,
  failureMessage,
  parseInspect,
  storeVerdict,
  waitingNote,
} from './dev-store-health.ts'

import type { Service } from './dev-services.ts'
import type { ContainerState, FailedVerdict } from './dev-store-health.ts'

const POLL_MS = 2_000
const STORE_TIMEOUT_MS = 120_000
const MAX_INSPECT_FAILURES = 10
const DOWNSTREAM = [runtime, backend, frontend]

async function capture(args: string[]): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = []
  const push = (line: string) => lines.push(stripAnsi(line))
  const result = await runDevCommand('docker', args, {
    cwd: COMPOSE_DIR,
    timeoutMs: 20_000,
    onStdout: push,
    onStderr: push,
  })

  return { ok: result.exitCode === 0, lines }
}

async function inspectStores(names: string[]): Promise<Map<string, ContainerState> | null> {
  const ps = await capture([...COMPOSE, 'ps', '-a', '-q', ...names])

  if (!ps.ok) return null
  const ids = ps.lines.map((line) => line.trim()).filter(Boolean)

  if (!ids.length) return new Map()
  const inspect = await capture(['inspect', ...ids])

  try {
    return inspect.ok ? parseInspect(inspect.lines.join('\n')) : null
  } catch {
    return null
  }
}

async function containerLogs(name: string): Promise<string> {
  return errorTail((await capture(['logs', '--tail', '5', name])).lines)
}

export type StoreProbe = {
  inspect: (names: string[]) => Promise<Map<string, ContainerState> | null>
  logs: (name: string) => Promise<string>
  pause: () => Promise<void>
  now: () => number
}

const dockerProbe: StoreProbe = {
  inspect: inspectStores,
  logs: containerLogs,
  pause: () => new Promise((resolve) => setTimeout(resolve, POLL_MS)),
  now: Date.now,
}

async function evidence(state: ContainerState | undefined, context: Context): Promise<string> {
  if (!state) return context.upTail
  if (state.healthOutput) return state.healthOutput.slice(0, 240)

  return (await context.probe.logs(state.name)) || context.upTail
}

export function setDownstreamNote(note: string | null) {
  for (const row of DOWNSTREAM) row.note = note
  markDirty()
}

function markReady(row: Service, recovered: boolean) {
  row.status = 'ready'
  row.health.health = '✓'
  row.readyMs = row.startedAt ? Date.now() - row.startedAt : null
  pushEvent(row, recovered ? 'recovered — healthy' : 'healthy')
}

function markFailed(row: Service, verdict: FailedVerdict, secs: number, found: string) {
  row.status = 'crashed'
  row.lastRaw = found || row.lastRaw
  pushEvent(row, failureMessage(verdict, secs, found))
}

type Round = { pending: string[]; alive: boolean }
type Context = { failed: Set<Service>; upTail: string; probe: StoreProbe }

async function judge(
  row: Service,
  state: ContainerState | undefined,
  elapsed: number,
  context: Context & { round: Round },
) {
  const verdict = storeVerdict(state, elapsed, STORE_TIMEOUT_MS)

  if (verdict.kind === 'ready') {
    markReady(row, context.failed.has(row))

    return
  }
  context.round.pending.push(row.name)
  if (verdict.kind !== 'dead') context.round.alive = true
  row.health.health = verdict.detail
  if (verdict.kind === 'waiting' || context.failed.has(row)) return
  context.failed.add(row)
  markFailed(row, verdict, Math.round(elapsed / 1000), await evidence(state, context))
}

function noteFor({ pending, alive }: Round): string | null {
  return alive || !pending.length ? waitingNote(pending) : blockedNote(pending)
}

function giveUpInspecting(rows: readonly Service[]) {
  const pending = rows.filter((row) => row.status !== 'ready')

  for (const row of pending) {
    row.status = 'crashed'
    pushEvent(row, 'cannot read container state from Docker — is Docker running? Press r to retry')
  }
  setDownstreamNote(blockedNote(pending.map((row) => row.name)))
}

/** True once every row is healthy; false when a store is gone for good, Docker stops answering, or the launcher quits. */
export async function watchStores(
  rows: readonly Service[],
  upTail: string,
  probe: StoreProbe = dockerProbe,
): Promise<boolean> {
  const started = probe.now()
  const context: Context = { failed: new Set(), upTail, probe }
  let inspectFailures = 0

  while (!isQuitting()) {
    const states = await probe.inspect(rows.map((row) => row.name))

    if (states) {
      inspectFailures = 0
      const round: Round = { pending: [], alive: false }

      for (const row of rows) {
        if (row.status !== 'ready')
          await judge(row, states.get(row.name), probe.now() - started, { ...context, round })
      }
      setDownstreamNote(noteFor(round))
      if (!round.pending.length) return true
      if (!round.alive) return false
    } else if (++inspectFailures >= MAX_INSPECT_FAILURES) {
      giveUpInspecting(rows)

      return false
    }
    await probe.pause()
  }

  return false
}
