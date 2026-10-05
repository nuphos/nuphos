import { useEffect, useRef } from 'react'

import { api } from '../../../api'
import { getActiveDiagramId } from '../../../architecture/activeDiagram'
import { trackError } from '../../../lib/analytics'
import { acceptRuntimeSnapshot } from '../../../lib/runtimeExecution'
import { shouldResumeRuntimeWakeup, wakeupTranscriptTail } from '../../../lib/runtimeWakeup'

import { fetchWakeupTranscriptTail, shouldDeferTranscriptCatchUp } from './conversationCatchUp'
import { CONVERSATION_TAIL_LIMIT } from './model'
import { fromPersistedMessages, transcriptSignature } from './persistence'
import { getAgentLocale } from './textUtils'
import { TIMELINE_CHANGED_EVENT } from './timelineEvents'
import { toUiMessages } from './toUiMessages'

import type { PanelCtx } from './ctx'

// The only way a device learns about work it did not start: another device of
// the same user (or a trigger, or a Slack turn) ran a turn on this
// conversation. Runtime-agnostic on purpose — every runtime buffers its run
// the same way, so gating this on one of them just left the others stale.
const WAKEUP_POLL_MS = 4_000

type Acc = Pick<
  PanelCtx,
  | 'activeTab'
  | 'kubeContextRef'
  | 'lastSyncedRef'
  | 'setTabs'
  | 'stoppedRunIdsRef'
  | 'tabsRef'
  | 'teamId'
  | 'urlRef'
  | 'visible'
>

export function useConversationCatchUp(acc: Acc): void {
  const revisions = useRef(new Map<string, string>())
  const {
    activeTab,
    kubeContextRef,
    lastSyncedRef,
    setTabs,
    stoppedRunIdsRef,
    tabsRef,
    teamId,
    urlRef,
    visible,
  } = acc

  useEffect(() => {
    if (!visible || !activeTab?.sessionId) return
    if (
      !activeTab.claudeCodeRuntimeAttached &&
      activeTab.messages.length === 0 &&
      !activeTab.streaming
    )
      return
    const sessionId = activeTab.sessionId
    const state = { stopped: false, polling: false }

    const poll = async () => {
      if (state.stopped) return
      if (state.polling) return
      state.polling = true
      try {
        // Metadata probe: `activeRun` and `messageCount` do not depend on how
        // many messages come back, so ask for one. The transcript tail is
        // fetched below only when the stored count has grown.
        const requestedAt = performance.now()
        const probe = await api.agentGetConversation(sessionId, teamId, { tail: 1 })

        if (state.stopped) return
        const current = tabsRef.current.find((tab) => tab.sessionId === sessionId)

        if (!current) return
        const runtimeState =
          performance.now() - requestedAt >= 12_000
            ? { state: 'disconnected' as const, observedAt: performance.now() }
            : {
                ...(probe.runtimeState ?? { state: 'unsupported' as const }),
                observedAt: requestedAt,
              }

        setTabs((tabs) =>
          tabs.map((tab) =>
            tab.sessionId === sessionId
              ? {
                  ...tab,
                  runtimeState: acceptRuntimeSnapshot(tab.runtimeState, runtimeState),
                  timelineEvents: probe.timelineEvents,
                }
              : tab,
          ),
        )
        // An open response is only a transport. It cannot override runtime state.
        // A fresh retry briefly has no backend activeRun and the runtime is idle.
        // Keep rendering its live transport; a stored failed-attempt transcript
        // must not replace it. Runtime status above is still always refreshed.
        if (shouldDeferTranscriptCatchUp(current, probe.activeRun)) return
        const activeRun = probe.activeRun
        const stoppedStreamId = stoppedRunIdsRef.current.get(sessionId)

        if (activeRun && !shouldResumeRuntimeWakeup(activeRun, stoppedStreamId)) return
        if (!activeRun || activeRun.streamId !== stoppedStreamId) {
          stoppedRunIdsRef.current.delete(sessionId)
        }

        if (activeRun) {
          const startedAt = activeRun.startedAt ? Date.parse(activeRun.startedAt) : Date.now()

          setTabs((tabs) =>
            tabs.map((tab) =>
              tab.sessionId === sessionId
                ? {
                    ...tab,
                    streaming: true,
                    connected: false,
                    streamId: activeRun.streamId,
                    attachedStreamId: activeRun.streamId,
                    streamStartedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
                    phase: null,
                    error: null,
                  }
                : tab,
            ),
          )
          void window.api
            .agentStart({
              streamId: activeRun.streamId,
              sessionId,
              teamId,
              messages: toUiMessages(current.messages),
              baseIndex: current.historyBaseIndex,
              locale: getAgentLocale(),
              url: urlRef.current,
              kubeContext: kubeContextRef.current ?? undefined,
              diagramId: getActiveDiagramId() ?? undefined,
              resume: true,
              resumeFrom: 0,
              credentialAccess: current.credentialAccess,
            })
            .catch((error: unknown) => {
              stoppedRunIdsRef.current.set(sessionId, activeRun.streamId)
              const message = error instanceof Error ? error.message : String(error)

              trackError(
                {
                  source: 'agent_stream',
                  phase: 'runtime_wakeup_resume_failed',
                  message,
                  streamId: activeRun.streamId,
                  sessionId,
                },
                error,
              )
              setTabs((tabs) =>
                tabs.map((tab) =>
                  tab.sessionId === sessionId && tab.streamId === activeRun.streamId
                    ? {
                        ...tab,
                        streaming: false,
                        streamId: null,
                        streamStartedAt: null,
                        error: message,
                      }
                    : tab,
                ),
              )
            })

          return
        }
        const revision = probe.transcriptUpdatedAt
        const contentChanged = Boolean(revision && revisions.current.get(sessionId) !== revision)
        const tail = wakeupTranscriptTail(
          probe.messageCount,
          current.historyBaseIndex,
          current.messages.length,
          CONVERSATION_TAIL_LIMIT,
          contentChanged,
        )

        if (tail === 0) return
        const fetched = await fetchWakeupTranscriptTail(
          () => tabsRef.current.find((tab) => tab.sessionId === sessionId),
          (requestedTail) => api.agentGetConversation(sessionId, teamId, { tail: requestedTail }),
          tail,
          CONVERSATION_TAIL_LIMIT,
        )

        if (!fetched || state.stopped) return
        const { detail, latest } = fetched
        const serverTail = fromPersistedMessages(detail.messages)
        const currentBase = latest.historyBaseIndex ?? 0
        const serverBase = detail.messagesFirstIndex ?? 0
        const retainedPrefixCount = Math.max(0, serverBase - currentBase)
        const messages =
          retainedPrefixCount > 0 && latest.messages.length >= retainedPrefixCount
            ? [...latest.messages.slice(0, retainedPrefixCount), ...serverTail]
            : serverTail
        const next = {
          ...latest,
          runtimeState: acceptRuntimeSnapshot(latest.runtimeState, runtimeState),
          messages,
          historyBaseIndex:
            retainedPrefixCount > 0 && latest.messages.length >= retainedPrefixCount
              ? currentBase
              : serverBase,
        }

        setTabs((tabs) =>
          tabs.map((tab) => {
            if (tab.sessionId !== sessionId || tab.streaming || tab.messages !== latest.messages)
              return tab
            if (detail.transcriptUpdatedAt)
              revisions.current.set(sessionId, detail.transcriptUpdatedAt)
            lastSyncedRef.current.set(sessionId, transcriptSignature(next))

            return {
              ...tab,
              messages: next.messages,
              historyBaseIndex: next.historyBaseIndex,
              runtimeState: acceptRuntimeSnapshot(tab.runtimeState, runtimeState),
            }
          }),
        )
      } catch {
        if (!state.stopped)
          setTabs((tabs) =>
            tabs.map((tab) =>
              tab.sessionId === sessionId
                ? { ...tab, runtimeState: { state: 'disconnected', observedAt: performance.now() } }
                : tab,
            ),
          )
      } finally {
        state.polling = false
      }
    }

    void poll()
    const timer = window.setInterval(() => void poll(), WAKEUP_POLL_MS)
    const pollIfThisSession = (event: Event) => {
      if ((event as CustomEvent<string>).detail === sessionId) void poll()
    }

    window.addEventListener(TIMELINE_CHANGED_EVENT, pollIfThisSession)

    return () => {
      state.stopped = true
      window.clearInterval(timer)
      window.removeEventListener(TIMELINE_CHANGED_EVENT, pollIfThisSession)
    }
  }, [
    activeTab?.sessionId,
    activeTab?.claudeCodeRuntimeAttached,
    activeTab?.messages.length,
    activeTab?.streaming,
    kubeContextRef,
    lastSyncedRef,
    setTabs,
    stoppedRunIdsRef,
    tabsRef,
    teamId,
    urlRef,
    visible,
  ])
}
