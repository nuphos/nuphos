import { api } from '../../../api'
import { getActiveDiagramId } from '../../../architecture/activeDiagram'
import { trackError } from '../../../lib/analytics'
import { toast } from '../../ui/toast'

import { finalizeIncompleteTools } from './clientTools'
import { reconcileStoredCredentialAccess, credentialSelectionSignature } from './credentialAccess'
import { CONVERSATION_TAIL_LIMIT } from './model'
import { fromPersistedMessages, transcriptSignature } from './persistence'
import { retainBackgroundTabs } from './sessionContinuity'
import { INTERRUPTED_TOOL_MESSAGE, uid } from './stall'
import { getAgentLocale } from './textUtils'
import { toUiMessages } from './toUiMessages'

import type { PanelCtx } from './ctx'
import type { Tab } from './model'

export type OpenConversationCtx = Pick<
  PanelCtx,
  | 'clearPendingOpen'
  | 'credentialAccessRef'
  | 'credentialOptions'
  | 'history'
  | 'kubeContextRef'
  | 'lastCredentialSyncedRef'
  | 'lastSyncedRef'
  | 'openGenerationRef'
  | 'pendingOpenRef'
  | 'setActiveId'
  | 'setOpeningConversation'
  | 'setTabAuditReadOnly'
  | 'setTabs'
  | 'tabsRef'
  | 'teamId'
  | 'urlRef'
  | 'uploadingTabsRef'
>

// `titleHint` covers conversations that aren't in the Recent page (e.g.
// opened from the full History page) so the opening spinner still shows a
// real title instead of the generic "Opening chat".
export async function runOpenConversation(
  ctx: OpenConversationCtx,
  sessionId: string,
  titleHint?: string,
  opts?: { forceReadOnly?: boolean },
) {
  const {
    clearPendingOpen,
    credentialAccessRef,
    credentialOptions,
    history,
    kubeContextRef,
    lastCredentialSyncedRef,
    lastSyncedRef,
    openGenerationRef,
    pendingOpenRef,
    setActiveId,
    setOpeningConversation,
    setTabAuditReadOnly,
    setTabs,
    tabsRef,
    teamId,
    urlRef,
    uploadingTabsRef,
  } = ctx

  const existing = tabsRef.current.find((t) => t.sessionId === sessionId)

  if (existing) {
    // Landing on a loaded tab is still an open, so it invalidates any slower
    // one in flight — without the bump that response lands afterwards and
    // replaces the conversation this just activated.
    openGenerationRef.current += 1
    clearPendingOpen(sessionId)
    setOpeningConversation(null)
    setTabAuditReadOnly(sessionId, opts?.forceReadOnly === true)
    setActiveId(existing.id)

    return
  }
  // Synchronously, before the first await and before the state below: the
  // reconciliation effect may run again in this very tick.
  pendingOpenRef.current = sessionId
  const generation = ++openGenerationRef.current
  const summary = history.find((conversation) => conversation.sessionId === sessionId)

  setOpeningConversation({
    sessionId,
    // Empty when the conversation isn't cached anywhere — the spinner then
    // shows its neutral "Opening chat" label instead of "Untitled chat".
    title: summary?.title || summary?.firstMessage || titleHint || '',
  })
  try {
    const runtimeObservedAt = performance.now()
    // The runtime probe is skipped unless a run needs confirming; the catch-up
    // poll fetches runtime state as soon as the tab is active.
    const detail = await api.agentGetConversation(sessionId, teamId, {
      tail: CONVERSATION_TAIL_LIMIT,
      runtimeState: 'omit',
    })

    if (openGenerationRef.current !== generation) {
      // Superseded: clear our own spinner only — a newer open may have
      // already put up its own (or none, when it landed on an existing tab).
      clearPendingOpen(sessionId)
      setOpeningConversation((cur) => (cur?.sessionId === sessionId ? null : cur))

      return
    }
    const historyBaseIndex = detail.messagesFirstIndex ?? 0
    const messages = fromPersistedMessages(detail.messages)
    const activeRun = detail.activeRun ?? null
    let replayBaseMessages = messages

    if (activeRun) {
      let lastUserIndex = -1

      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user') {
          lastUserIndex = i
          break
        }
      }
      replayBaseMessages = lastUserIndex >= 0 ? messages.slice(0, lastUserIndex + 1) : messages
    }
    if (!activeRun) {
      replayBaseMessages = finalizeIncompleteTools(replayBaseMessages, INTERRUPTED_TOOL_MESSAGE)
    }
    const credentialAccess = reconcileStoredCredentialAccess(
      detail.credentialAccess,
      credentialOptions,
    )
    const activeStartedAt = activeRun?.startedAt ? Date.parse(activeRun.startedAt) : NaN
    const streamStartedAt = Number.isFinite(activeStartedAt) ? activeStartedAt : Date.now()
    const tab: Tab = {
      id: uid(),
      sessionId: detail.sessionId,
      title: detail.title,
      messages: replayBaseMessages,
      streaming: Boolean(activeRun),
      connected: !activeRun,
      phase: null,
      streamId: activeRun?.streamId ?? null,
      streamStartedAt: activeRun ? streamStartedAt : null,
      error:
        !activeRun && replayBaseMessages.length === 0
          ? 'This conversation has no saved messages yet.'
          : null,
      autoResumeAttempts: 0,
      historyBaseIndex,
      credentialAccess,
      readOnly: detail.readOnly === true || opts?.forceReadOnly === true,
      auditForcedReadOnly:
        opts?.forceReadOnly === true && detail.readOnly !== true ? true : undefined,
      foreign: detail.isOwner === false ? true : undefined,
      canManage: detail.canManage === true ? true : undefined,
      slackThread: detail.slackThread ?? null,
      activitySource: detail.activitySource,
      claudeCodeRuntimeAttached: detail.claudeCodeRuntimeAttached,
      runtimeState: detail.runtimeState
        ? { ...detail.runtimeState, observedAt: runtimeObservedAt }
        : undefined,
      agentRuntime: detail.agentRuntime,
      runtimeId: detail.runtimeId,
      runtimeLabel: detail.runtimeLabel,
      timelineEvents: detail.timelineEvents,
      promptSuggestion: detail.promptSuggestion,
      openedAt: Date.now(),
    }

    lastSyncedRef.current.set(tab.sessionId, transcriptSignature(tab))
    credentialAccessRef.current.set(tab.sessionId, tab.credentialAccess)
    lastCredentialSyncedRef.current.set(
      tab.sessionId,
      credentialSelectionSignature(tab.credentialAccess),
    )
    setTabs((prev) => [
      ...retainBackgroundTabs(prev, uploadingTabsRef.current).filter(
        (existingTab) => existingTab.sessionId !== tab.sessionId,
      ),
      tab,
    ])
    setActiveId(tab.id)
    clearPendingOpen(sessionId)
    setOpeningConversation(null)
    if (activeRun) {
      void window.api
        .agentStart({
          streamId: activeRun.streamId,
          sessionId: detail.sessionId,
          teamId,
          messages: toUiMessages(replayBaseMessages),
          baseIndex: historyBaseIndex,
          locale: getAgentLocale(),
          url: urlRef.current,
          kubeContext: kubeContextRef.current ?? undefined,
          diagramId: getActiveDiagramId() ?? undefined,
          resume: true,
          resumeFrom: 0,
          credentialAccess: tab.credentialAccess,
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)

          trackError(
            {
              source: 'agent_stream',
              phase: 'active_run_resume_failed',
              message,
              streamId: activeRun.streamId,
              sessionId: detail.sessionId,
            },
            err,
          )
          setTabs((prev) =>
            prev.map((t) =>
              t.sessionId === detail.sessionId && t.streamId === activeRun.streamId
                ? {
                    ...t,
                    streaming: false,
                    streamId: null,
                    phase: null,
                    streamStartedAt: null,
                    error: message,
                  }
                : t,
            ),
          )
        })
    }
  } catch (err) {
    if (openGenerationRef.current !== generation) {
      // Superseded: silently clear our own spinner; the failure belongs to
      // an open the user already navigated away from.
      setOpeningConversation((cur) => (cur?.sessionId === sessionId ? null : cur))

      return
    }
    toast.apiError('Failed to open conversation', err)
    clearPendingOpen(sessionId)
    setOpeningConversation(null)
  }
}
