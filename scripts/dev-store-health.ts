// Pure verdicts behind the mongo / rustfs rows while the launcher waits for them.

export type ContainerState = {
  service: string
  name: string
  status: string
  health: string | null
  restarting: boolean
  exitCode: number
  healthOutput: string
}

/** `recovering` may still turn healthy on its own; `dead` will not without another `compose up`. */
export type StoreVerdict =
  | { kind: 'ready' }
  | { kind: 'waiting'; detail: string }
  | { kind: 'recovering'; detail: string }
  | { kind: 'dead'; detail: string }

export type FailedVerdict = Exclude<StoreVerdict, { kind: 'ready' }>

type InspectEntry = {
  Name?: string
  RestartCount?: number
  Config?: { Labels?: Record<string, string> }
  State?: {
    Status?: string
    Restarting?: boolean
    ExitCode?: number
    Health?: { Status?: string; Log?: { Output?: string }[] }
  }
}

/** Containers from `docker inspect`, keyed by their compose service. */
export function parseInspect(json: string): Map<string, ContainerState> {
  const entries = JSON.parse(json) as InspectEntry[]
  const out = new Map<string, ContainerState>()

  for (const entry of entries) {
    const service = entry.Config?.Labels?.['com.docker.compose.service']

    if (!service) continue
    const state = entry.State ?? {}

    out.set(service, {
      service,
      name: (entry.Name ?? service).replace(/^\//, ''),
      status: state.Status ?? 'unknown',
      health: state.Health?.Status ?? null,
      restarting: state.Restarting === true,
      exitCode: state.ExitCode ?? 0,
      healthOutput: (state.Health?.Log?.at(-1)?.Output ?? '').trim(),
    })
  }

  return out
}

export function storeVerdict(
  state: ContainerState | undefined,
  elapsedMs: number,
  timeoutMs: number,
): StoreVerdict {
  if (!state) return { kind: 'dead', detail: 'no container' }
  if (state.health === 'healthy' || (state.health === null && state.status === 'running'))
    return { kind: 'ready' }
  if (state.status === 'created') return { kind: 'dead', detail: 'container never started' }
  if (!state.restarting && (state.status === 'exited' || state.status === 'dead'))
    return { kind: 'dead', detail: `exited (code ${String(state.exitCode)})` }
  const detail = state.restarting ? 'restarting' : (state.health ?? state.status)

  return elapsedMs < timeoutMs ? { kind: 'waiting', detail } : { kind: 'recovering', detail }
}

/** A stack left by an older version or other secrets, as opposed to a slow or flaky start. */
const STALE_EVIDENCE = [
  /HTTP 40[13]\b/,
  /InvalidAccessKeyId|SignatureDoesNotMatch|AccessDenied/,
  /InvalidReplicaSetConfig|replica set config is invalid/i,
  /incompatible|was created (?:with|by) a (?:newer|different)/i,
]

export function looksStale(evidence: string): boolean {
  return STALE_EVIDENCE.some((pattern) => pattern.test(evidence))
}

/** One dashboard line for a data store that is not coming up, and what to do about it. */
export function failureMessage(verdict: FailedVerdict, secs: number, evidence: string): string {
  const what =
    verdict.kind === 'dead'
      ? verdict.detail
      : `not healthy after ${String(secs)}s (${verdict.detail})`
  const why = evidence ? `: ${evidence}` : ''

  return `${what}${why} — ${nextStep(verdict, evidence)}`
}

function nextStep(verdict: FailedVerdict, evidence: string): string {
  if (looksStale(evidence))
    return 'the stack predates this version or its secrets — wipe it with bun run dev:reset'

  return verdict.kind === 'dead'
    ? 'see bun run dev:logs, then press r'
    : 'still watching; see bun run dev:logs'
}

export function blockedNote(pending: readonly string[]): string {
  return `blocked on ${pending.join(' and ')} — press r once fixed`
}

/** What the rows downstream of the data stores show while they wait. */
export function waitingNote(pending: readonly string[]): string | null {
  return pending.length ? `waiting for ${pending.join(' and ')} …` : null
}
