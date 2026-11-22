import { useCallback, useMemo } from 'react'

import { getActiveDiagramId } from '../../../architecture/activeDiagram'
import { trackError } from '../../../lib/analytics'

import { runDecideAuthorization } from './authorizationDecide'
import { newAgentStreamId } from './stall'
import { getAgentLocale } from './textUtils'
import { toUiMessages } from './toUiMessages'

import type { PanelCtx } from './ctx'
import type { AuthorizationDecisionAction } from './parts'

type Acc = Pick<
  PanelCtx,
  | 'activeId'
  | 'activePendingAuthToolCallId'
  | 'activeTab'
  | 'credentialAccessRef'
  | 'kubeContextRef'
  | 'sendableCredentialAccess'
  | 'setTabs'
  | 'tabsRef'
  | 'teamId'
  | 'urlRef'
>

export function useAuthorizationFlows(acc: Acc) {
  const {
    activeId,
    activePendingAuthToolCallId,
    activeTab,
    credentialAccessRef,
    kubeContextRef,
    sendableCredentialAccess,
    setTabs,
    tabsRef,
    teamId,
    urlRef,
  } = acc

  const decideAuthorization = useCallback(
    (toolCallId: string, decision: AuthorizationDecisionAction) =>
      runDecideAuthorization(
        {
          tabsRef,
          activeId,
          setTabs,
          sendableCredentialAccess,
          credentialAccessRef,
          teamId,
          urlRef,
          kubeContextRef,
        },
        toolCallId,
        decision,
      ),
    [
      tabsRef,
      activeId,
      setTabs,
      sendableCredentialAccess,
      credentialAccessRef,
      teamId,
      urlRef,
      kubeContextRef,
    ],
  )

  // Resume a turn that PAUSED on an inline permission-grant proposal, after the
  // admin approved/rejected it. Vercel-AI-SDK HITL pattern: rewrite the paused
  // tool call's RESULT with the outcome (addToolResult) — no fake user message —
  // then replay the transcript as a fresh continuation stream so the model
  // continues from the updated tool result.
  const resumePermissionTurn = useCallback(
    (toolCallId: string, output: Record<string, unknown>) => {
      const tab = tabsRef.current.find((t) => t.id === activeId)

      if (!tab?.sessionId || tab.readOnly) return
      const updatedMessages = tab.messages.map((m) => ({
        ...m,
        parts: m.parts.map((p) =>
          p.type === 'tool' && p.toolCallId === toolCallId ? { ...p, output } : p,
        ),
      }))
      const streamId = newAgentStreamId()
      const credentialAccess = sendableCredentialAccess(
        credentialAccessRef.current.get(tab.sessionId) ?? tab.credentialAccess,
      )

      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                messages: updatedMessages,
                streaming: true,
                connected: false,
                phase: null,
                streamId,
                streamStartedAt: Date.now(),
                error: null,
                autoResumeAttempts: 0,
                credentialAccess,
              }
            : t,
        ),
      )
      void window.api
        .agentStart({
          streamId,
          sessionId: tab.sessionId,
          teamId,
          messages: toUiMessages(updatedMessages),
          baseIndex: tab.historyBaseIndex,
          locale: getAgentLocale(),
          url: urlRef.current,
          kubeContext: kubeContextRef.current ?? undefined,
          diagramId: getActiveDiagramId() ?? undefined,
          credentialAccess,
          continueAfterInterruption: true,
          // Clean HITL pause, not an interruption — reframes the backend's
          // continuation nudge so the model reads the tool result as
          // authoritative instead of defensively re-verifying the IAM state.
          resumeReason: 'permission-decision',
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)

          trackError(
            {
              source: 'agent_stream',
              phase: 'permission_resume_failed',
              message,
              streamId,
              sessionId: tab.sessionId,
            },
            err,
          )
          setTabs((prev) =>
            prev.map((t) =>
              t.streamId === streamId
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
    },
    [activeId, teamId, sendableCredentialAccess],
  )
  const authorizationContextValue = useMemo(
    () => ({
      decide: decideAuthorization,
      activeToolCallId: activePendingAuthToolCallId,
      readOnly: activeTab?.readOnly ?? false,
    }),
    [decideAuthorization, activePendingAuthToolCallId, activeTab?.readOnly],
  )

  return {
    decideAuthorization,
    resumePermissionTurn,
    authorizationContextValue,
  }
}
