import { OpenAbConnectionLostError, OpenAbRpcError } from './openab-acp-errors'

import type { PreviewToolStep } from './preview-transcript'

import { redactSecrets } from '@/lib/journal/redact'
import { errorMessage } from '@/lib/observability-sanitize'

/** A backend deadline, with the actual configured window rather than a guessed default. */
export class OpenAbTimeoutError extends Error {
  constructor(
    message: string,
    readonly timeoutKind: 'inactivity' | 'progress',
    readonly timeoutMs: number,
  ) {
    super(message)
    this.name = 'OpenAbTimeoutError'
  }
}

export type TurnDiagnostics = {
  streamId: string
  startedAt: string
  endedAt: string
  lastProgressAt?: string
  elapsedMs: number
  /** Backend-observed progress, not the runtime watchdog's internal clock. */
  progressSilenceMs?: number
  runtimeId?: string
  provider?: string
  buildSha?: string
  adapterVersion?: string
  source: 'backend' | 'runtime' | 'transport' | 'cancel' | 'unknown'
  error?: string
  errorCode?: number
  timeoutKind?: 'inactivity' | 'progress' | 'runtime-reported-unknown'
  timeoutMs?: number
  lastTool?: { toolCallId: string; toolName: string; status: string }
}

export function turnDiagnostics(args: {
  streamId: string
  startedAt: number
  endedAt?: number
  lastProgressAt?: number
  runtimeId?: string
  provider?: string
  buildSha?: string
  adapterVersion?: string
  error?: unknown
  aborted?: boolean
  toolSteps: PreviewToolStep[]
}): TurnDiagnostics {
  const endedAt = args.endedAt ?? Date.now()
  const error = args.error
  const message = error === undefined ? '' : errorMessage(error)
  // Older runtime wording proves the layer, not elapsed-time vs silence semantics.
  const runtimeTimeout = /Agent exceeded hard timeout \((\d+)s\)/u.exec(message)
  const lastTool = args.toolSteps.at(-1)
  let source: TurnDiagnostics['source'] = 'unknown'

  if (error === undefined || error instanceof OpenAbRpcError || runtimeTimeout) source = 'runtime'
  if (error instanceof OpenAbConnectionLostError) source = 'transport'
  if (error instanceof OpenAbTimeoutError) source = 'backend'
  if (args.aborted) source = 'cancel'
  let timeoutKind: TurnDiagnostics['timeoutKind']
  let timeoutMs: number | undefined

  if (runtimeTimeout) {
    timeoutKind = 'runtime-reported-unknown'
    timeoutMs = Number(runtimeTimeout[1]) * 1000
  }
  if (error instanceof OpenAbTimeoutError) {
    timeoutKind = error.timeoutKind
    timeoutMs = error.timeoutMs
  }
  let toolStatus = 'pending'

  if (lastTool?.output !== undefined) toolStatus = 'completed'
  if (lastTool?.errorText !== undefined) toolStatus = 'failed'

  return {
    streamId: args.streamId,
    startedAt: new Date(args.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    elapsedMs: Math.max(0, endedAt - args.startedAt),
    lastProgressAt:
      args.lastProgressAt === undefined ? undefined : new Date(args.lastProgressAt).toISOString(),
    progressSilenceMs:
      args.lastProgressAt === undefined ? undefined : Math.max(0, endedAt - args.lastProgressAt),
    runtimeId: args.runtimeId,
    provider: args.provider,
    buildSha: args.buildSha,
    adapterVersion: args.adapterVersion,
    source,
    error: message ? redactSecrets(message).redacted.slice(0, 2000) : undefined,
    errorCode: error instanceof OpenAbRpcError ? error.code : undefined,
    timeoutKind,
    timeoutMs,
    lastTool: lastTool
      ? {
          toolCallId: lastTool.toolCallId,
          toolName: redactSecrets(lastTool.toolName).redacted.slice(0, 200),
          status: toolStatus,
        }
      : undefined,
  }
}

/** Keep the observed build after a socket closes and evicts the live registry entry. */
export function createTurnDiagnostics(
  context: Pick<TurnDiagnostics, 'streamId' | 'runtimeId' | 'provider'> & { startedAt: number },
  observe: () => {
    buildSha?: string
    adapterVersion?: string
    toolSteps: () => PreviewToolStep[]
    aborted: boolean
  },
) {
  let lastProgressAt: number | undefined
  let build: { buildSha?: string; adapterVersion?: string } = {}
  const observation = () => {
    const current = observe()

    if (current.buildSha || current.adapterVersion) {
      build = { buildSha: current.buildSha, adapterVersion: current.adapterVersion }
    }

    return { ...current, ...build }
  }

  return {
    observe: observation,
    progress: () => {
      lastProgressAt = Date.now()
      if (!build.buildSha && !build.adapterVersion) observation()
    },
    finish: (error?: unknown) => {
      const current = observation()

      return turnDiagnostics({
        ...context,
        ...current,
        toolSteps: current.toolSteps(),
        lastProgressAt,
        error,
      })
    },
  }
}
