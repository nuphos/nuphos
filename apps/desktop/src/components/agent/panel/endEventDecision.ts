import { buildAgentStatusNotification } from '../../../lib/agentStopNotification.ts'
import { runBelongsToThisClient } from '../../../lib/clientToolPhase.ts'

import { findPendingClientSideLocalTools } from './clientTools.ts'
import { foldTextDeltaIntoTab } from './streamText.ts'

import type { PanelCtx } from './ctx'
import type { Tab, Message } from './model'
import type { ToolPart } from './parts'
import type { StallDetail, reportAgentFailureToBackend } from './stall'
import type { AgentCredentialSelection } from '../../../api'

export type ResumePayload = {
  streamId: string
  sessionId: string
  teamId?: string
  messages: unknown[]
  baseIndex?: number
  locale?: string
  url?: string
  kubeContext?: string
  diagramId?: string
  credentialAccess?: AgentCredentialSelection
}

export type EndDecision = {
  resumePayload: ResumePayload | null
  incompleteToolResume: { sessionId: string; streamId: string } | null
  clientToolPayload: {
    tabId: string
    sessionId: string
    title: string
    messages: Message[]
    tools: ToolPart[]
    credentialAccess: AgentCredentialSelection
  } | null
  terminalFailureReportPayload: Parameters<typeof reportAgentFailureToBackend>[0] | null
  stopNotification: { title: string; body: string; sessionId: string } | null
  orphaned: boolean
  updaterRan: boolean
}

export function emptyEndDecision(): EndDecision {
  return {
    resumePayload: null,
    incompleteToolResume: null,
    clientToolPayload: null,
    terminalFailureReportPayload: null,
    stopNotification: null,
    orphaned: false,
    updaterRan: false,
  }
}

type DecideArgs = {
  streamId: string
  pendingText: string
  sawTurnComplete: boolean
  sawTurnPaused: { reason: string; detail?: StallDetail } | undefined
  stopRequested?: boolean
  decision: EndDecision
}

export function decideEndOfStream(
  _ctx: Pick<PanelCtx, 'kubeContextRef' | 'queueTranscriptSync' | 'teamIdRef' | 'urlRef'>,
  args: DecideArgs,
  prev: Tab[],
): Tab[] {
  const { streamId, pendingText, decision } = args

  decision.updaterRan = true
  const flushed = pendingText
    ? prev.map((t) => (t.streamId === streamId ? foldTextDeltaIntoTab(t, pendingText) : t))
    : prev

  const tabSnapshot = flushed.find((t) => t.streamId === streamId)

  decision.orphaned = !tabSnapshot
  // A run this client only followed is the owner's to finish: it runs the
  // pending local tools and recovers a dropped transport. Doing either here
  // would run the tool twice, or mint a stream that starts a competing turn on
  // the same session — and that new stream, no longer matching the marker,
  // would look locally owned on ITS end event.
  //
  // Nothing is finalized either: the turn is not over, it is over HERE. A
  // notification would announce a finish that hasn't happened, and the
  // transcript belongs to the owner. Just stop following; the catch-up poll
  // picks up whatever the owner does next.
  if (tabSnapshot && !runBelongsToThisClient(tabSnapshot, streamId)) {
    return flushed.map((t) =>
      t.id === tabSnapshot.id
        ? {
            ...t,
            streaming: false,
            connected: false,
            streamId: null,
            phase: null,
            streamStartedAt: null,
            autoResumeAttempts: 0,
          }
        : t,
    )
  }
  // Deliberately NOT gated on `sawTurnComplete`: a client-side tool call
  // left in input-available is the client's job to run no matter how the
  // stream ended, and the backend emits a clean turn-complete for reasons
  // of its own (awaitingAuthorization anywhere in the turn). Skipping the
  // dispatch on that signal stranded the turn with a tool card that never
  // ran, no error and no timer watching it.
  if (tabSnapshot && !tabSnapshot.error) {
    const requestedTools = new Set(
      tabSnapshot.runtimeState?.requests
        ?.filter((request) => request.kind === 'client-tool')
        .map((request) => request.waitId),
    )
    const pendingClientTools = findPendingClientSideLocalTools(tabSnapshot.messages).filter(
      (tool) => requestedTools.has(tool.toolCallId),
    )

    if (pendingClientTools.length > 0) {
      decision.clientToolPayload = {
        tabId: tabSnapshot.id,
        sessionId: tabSnapshot.sessionId,
        title: tabSnapshot.title,
        messages: tabSnapshot.messages,
        tools: pendingClientTools,
        credentialAccess: tabSnapshot.credentialAccess,
      }

      return flushed.map((t) =>
        t.id === tabSnapshot.id
          ? {
              ...t,
              streaming: true,
              streamId: null,
              phase: null,
              // `streaming` without a timestamp is what made this phase
              // invisible to every watchdog. Keep the clock running: the
              // phase watchdog reads it, nothing else does.
              streamStartedAt: Date.now(),
              error: null,
              autoResumeAttempts: 0,
            }
          : t,
      )
    }
  }

  const failedPause =
    args.sawTurnPaused &&
    !['shutdown', 'model-silence', 'tool-execution-timeout'].includes(args.sawTurnPaused.reason)

  if (
    tabSnapshot &&
    !args.stopRequested &&
    (args.sawTurnComplete || tabSnapshot.error || failedPause)
  ) {
    decision.stopNotification = {
      ...buildAgentStatusNotification({
        messages: tabSnapshot.messages,
        failed: Boolean(tabSnapshot.error || failedPause),
      }),
      sessionId: tabSnapshot.sessionId,
    }
  }

  // Subscription EOF never starts another model turn, including the first turn
  // before its first snapshot arrives. Runtime owns recovery and continuation.
  return flushed.map((tab) =>
    tab.id === tabSnapshot?.id
      ? {
          ...tab,
          streaming: false,
          connected: false,
          streamId: null,
          phase: null,
          streamStartedAt: null,
          autoResumeAttempts: 0,
        }
      : tab,
  )
}
