import { OpenAbConnectionLostError, OpenAbRpcError } from './openab-acp-errors'

import type { PreviewToolStep } from './preview-transcript'
import type { TurnDiagnostics } from '@/lib/agent/turn-diagnostics-schema'

import { turnDiagnosticsSchema } from '@/lib/agent/turn-diagnostics-schema'
import { errorMessage } from '@/lib/observability-sanitize'

/** A backend deadline, with the actual configured window rather than a guessed default. */
export class OpenAbTimeoutError extends Error {
  constructor(
    message: string,
    readonly timeoutKind: 'inactivity' | 'progress' | 'call-deadline',
    readonly timeoutMs: number,
  ) {
    super(message)
    this.name = 'OpenAbTimeoutError'
  }
}

export type { TurnDiagnostics } from '@/lib/agent/turn-diagnostics-schema'

export function turnDiagnostics(args: {
  streamId: string
  startedAt: number
  endedAt?: number
  lastOutputAt?: number
  runtimeId?: string
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
  if (args.aborted) source = 'abort'
  let timeoutKind: TurnDiagnostics['timeoutKind']
  let timeoutMs: number | undefined

  if (runtimeTimeout) {
    timeoutKind = 'runtime-reported-unknown'
    const reported = Number(runtimeTimeout[1]) * 1000

    timeoutMs = Number.isFinite(reported) ? reported : undefined
  }
  if (error instanceof OpenAbTimeoutError) {
    timeoutKind = error.timeoutKind
    timeoutMs = error.timeoutMs
  }
  let toolStatus: 'pending' | 'completed' | 'failed' = 'pending'

  if (lastTool?.output !== undefined) toolStatus = 'completed'
  if (lastTool?.errorText !== undefined) toolStatus = 'failed'

  return turnDiagnosticsSchema.parse({
    streamId: args.streamId,
    startedAt: new Date(args.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    elapsedMs: Math.max(0, endedAt - args.startedAt),
    lastOutputAt:
      args.lastOutputAt === undefined ? undefined : new Date(args.lastOutputAt).toISOString(),
    outputSilenceMs:
      args.lastOutputAt === undefined ? undefined : Math.max(0, endedAt - args.lastOutputAt),
    runtimeId: args.runtimeId,
    buildSha: args.buildSha,
    adapterVersion: args.adapterVersion,
    source,
    error: message || undefined,
    errorCode: error instanceof OpenAbRpcError ? error.code : undefined,
    timeoutKind,
    timeoutMs,
    lastTool: lastTool
      ? {
          toolCallId: lastTool.toolCallId,
          toolName: lastTool.toolName,
          status: toolStatus,
        }
      : undefined,
  })
}

/** Keep the observed build after a socket closes and evicts the live registry entry. */
export function createTurnDiagnostics(
  context: Pick<TurnDiagnostics, 'streamId' | 'runtimeId'> & { startedAt: number },
  observe: () => {
    buildSha?: string
    adapterVersion?: string
    toolSteps: () => PreviewToolStep[]
    aborted: boolean
  },
) {
  let lastOutputAt: number | undefined
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
      lastOutputAt = Date.now()
    },
    finish: (error?: unknown) => {
      const current = observation()

      return turnDiagnostics({
        ...context,
        ...current,
        toolSteps: current.toolSteps(),
        lastOutputAt,
        error,
      })
    },
  }
}
