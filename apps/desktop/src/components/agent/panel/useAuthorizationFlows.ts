import { useCallback, useMemo } from 'react'

import { api } from '../../../api'
import { getActiveDiagramId } from '../../../architecture/activeDiagram'
import { track, trackError } from '../../../lib/analytics'
import { toast } from '../../ui/toast'

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
  | 'sendInActive'
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
    sendInActive,
    sendableCredentialAccess,
    setTabs,
    tabsRef,
    teamId,
    urlRef,
  } = acc

  // Shared reject / request-changes handler for the inline card and the side
  // pane. `revise` keeps the plan `proposed` so the agent's revision tools
  // (which only edit a proposed plan) still work — only a hard `delete` marks
  // it rejected. `label` is how the plan is named in the synthetic message.
  const handleRejectPlan = useCallback(
    async (planId: string, reason: string, mode: 'revise' | 'delete', label: string) => {
      if (activeTab?.readOnly) return
      const trimmed = reason.trim()

      if (mode === 'delete') {
        track('agent_plan_rejected', { mode, plan_id: planId })
        // Hard reject — drop the plan from the library (soft-remove via status
        // today; a true DELETE endpoint is a follow-up). Land the status change
        // before telling the agent to discard, so a failed PATCH doesn't leave
        // a still-`proposed` plan the agent has abandoned.
        try {
          await api.agentUpdatePlan(planId, { status: 'rejected' }, teamId)
        } catch (err) {
          console.warn('[plan] failed to mark rejected', err)
          toast.apiError('Could not reject plan', err)

          return
        }
        // A reject never carries a reason — it's a direct discard.
        void sendInActive(`Rejected ${label} — discard it and stop.`, [])
      } else {
        // `has_reason` rather than the reason itself: plan feedback is free text
        // about a customer's infrastructure and must not leave the app.
        track('agent_plan_changes_requested', { plan_id: planId, has_reason: trimmed.length > 0 })
        // Request changes — leave the plan `proposed` so the agent can revise
        // it in place; just send the feedback.
        void sendInActive(
          trimmed
            ? `Requested changes to ${label}. ${trimmed}`
            : `Requested changes to ${label} — please revise the approach.`,
          [],
        )
      }
    },
    [activeTab, teamId, sendInActive],
  )
  const decideAuthorization = useCallback(
    (toolCallId: string, decision: AuthorizationDecisionAction, ruleDescription?: string) =>
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
        ruleDescription,
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

  const removeQueued = useCallback((tabId: string, queuedId: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId ? { ...t, queued: (t.queued ?? []).filter((q) => q.id !== queuedId) } : t,
      ),
    )
  }, [])

  return {
    handleRejectPlan,
    decideAuthorization,
    resumePermissionTurn,
    authorizationContextValue,
    removeQueued,
  }
}
