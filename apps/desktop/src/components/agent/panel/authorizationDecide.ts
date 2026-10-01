import { api } from '../../../api'
import { getActiveDiagramId } from '../../../architecture/activeDiagram'
import { trackError } from '../../../lib/analytics'
import { CLIENT_SIDE_LOCAL_TOOLS } from '../../../lib/clientToolPhase'
import { toast } from '../../ui/toast'

import { trackAuthorizationDecision } from './authorizationTelemetry'
import { executeClientToolWithDeadline, localToolFallbackOutput } from './clientTools'
import { newAgentStreamId } from './stall'
import { getAgentLocale } from './textUtils'
import { toUiMessages } from './toUiMessages'

import type { PanelCtx } from './ctx'
import type { Message } from './model'
import type { AuthorizationDecisionAction, ToolPart } from './parts'
// Native AI SDK HITL: the user approves/denies a bash command the SDK paused
// with a tool-approval-request. We stamp the approval RESPONSE onto the same
// tool card (approval-responded) and resubmit the transcript — the backend's
// convertToModelMessages turns it into a ToolApprovalResponse, and the SDK
// executes (approved) or denies the tool IN PLACE, with no model re-issue and
// no synthetic user turn. "Always allow" additionally creates a standing rule
// so future commands of that class skip approval entirely.
export type DecideAuthorizationCtx = Pick<
  PanelCtx,
  | 'activeId'
  | 'credentialAccessRef'
  | 'kubeContextRef'
  | 'sendableCredentialAccess'
  | 'setTabs'
  | 'tabsRef'
  | 'teamId'
  | 'urlRef'
>

/**
 * Persists a session-scoped grant so the backend stops re-prompting for this
 * command (and same-effect retries) within the conversation. Returns false when
 * the command text could not be read: the approval itself still proceeds, but
 * only as a one-shot, and the user is told so rather than being silently
 * re-prompted later.
 */
async function persistSessionGrant(args: {
  messages: Message[]
  toolCallId: string
  sessionId: string
}): Promise<boolean> {
  const { messages, sessionId, toolCallId } = args
  const grantedPart = messages
    .flatMap((m) => m.parts)
    .find((p): p is ToolPart => p.type === 'tool' && p.toolCallId === toolCallId)
  const command = (grantedPart?.input as { command?: unknown } | undefined)?.command

  if (typeof command !== 'string' || !command.trim()) {
    toast.error(
      'Approved once only',
      'Could not read the command text, so this approval was not saved for the session.',
    )

    return false
  }
  await api.agentAddAutoModeSessionApproval(sessionId, command)

  return true
}

export function runDecideAuthorization(
  ctx: DecideAuthorizationCtx,
  toolCallId: string,
  decision: AuthorizationDecisionAction,
  ruleDescription?: string,
) {
  const {
    activeId,
    credentialAccessRef,
    kubeContextRef,
    sendableCredentialAccess,
    setTabs,
    tabsRef,
    teamId,
    urlRef,
  } = ctx

  const tab = tabsRef.current.find((t) => t.id === activeId)

  if (!tab?.sessionId || tab.readOnly) return
  const approved = decision !== 'deny'
  const stampResponse = (messages: typeof tab.messages) =>
    messages.map((m) => ({
      ...m,
      parts: m.parts.map((p) =>
        p.type === 'tool' && p.toolCallId === toolCallId && p.approval
          ? {
              ...p,
              state: 'approval-responded' as const,
              approval: { ...p.approval, approved },
              // Execution (if approved) starts now — the elapsed badge must
              // not count the time the card sat waiting for this decision.
              startedAt: Date.now(),
            }
          : p,
      ),
    }))
  const respondedMessages = stampResponse(tab.messages)

  // Optimistic: the buttons disappear immediately.
  setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, messages: respondedMessages } : t)))
  void (async () => {
    try {
      // What actually took effect. Both branches can silently fall back to a
      // one-shot approval, and the gradient has to report the effect, not the
      // request — see trackAuthorizationDecision.
      let effectiveDecision = decision

      if (approved && decision === 'always') {
        if (ruleDescription?.trim()) {
          await api.agentCreateAutoModeRule(ruleDescription.trim())
        } else {
          effectiveDecision = 'once'
        }
      }
      if (approved && decision === 'session') {
        const persisted = await persistSessionGrant({
          messages: tab.messages,
          toolCallId,
          sessionId: tab.sessionId,
        })

        if (!persisted) effectiveDecision = 'once'
      }
      // Emitted only now that the standing rule / session grant landed — see
      // trackAuthorizationDecision for why an earlier emit double-counts.
      trackAuthorizationDecision({
        messages: tab.messages,
        toolCallId,
        sessionId: tab.sessionId,
        decision,
        effectiveDecision,
        approved,
        ruleDescription,
      })

      // Client tools (port-forwards, attachment upload) have no server execute:
      // on approve, run them here and attach the real output, so the
      // resubmitted transcript carries a plain executed tool call.
      let resumeMessages = respondedMessages
      const approvedPart = approved
        ? tab.messages
            .flatMap((m) => m.parts)
            .find(
              (p): p is ToolPart =>
                p.type === 'tool' &&
                p.toolCallId === toolCallId &&
                CLIENT_SIDE_LOCAL_TOOLS.has(p.toolName),
            )
        : undefined

      if (approvedPart) {
        // The badge times execution only, not the wait for approval.
        const executionStartedAt = Date.now()
        let output: unknown

        try {
          output = await executeClientToolWithDeadline({
            sessionId: tab.sessionId,
            toolCallId,
            toolName: approvedPart.toolName,
            input: approvedPart.input,
          })
        } catch (err) {
          output = localToolFallbackOutput(
            approvedPart.toolName,
            err instanceof Error ? err.message : String(err),
          )
        }
        resumeMessages = tab.messages.map((m) => ({
          ...m,
          parts: m.parts.map((p) =>
            p.type === 'tool' && p.toolCallId === toolCallId
              ? {
                  ...p,
                  state: 'output-available' as const,
                  output,
                  approval: undefined,
                  startedAt: executionStartedAt,
                  completedAt: Date.now(),
                }
              : p,
          ),
        }))
      }
      const streamId = newAgentStreamId()
      const credentialAccess = sendableCredentialAccess(
        credentialAccessRef.current.get(tab.sessionId) ?? tab.credentialAccess,
      )

      setTabs((prev) =>
        prev.map((t) =>
          t.id === tab.id
            ? {
                ...t,
                messages: resumeMessages,
                streaming: true,
                connected: false,
                phase: null,
                streamId,
                streamStartedAt: Date.now(),
                error: null,
                bootQuiet: true,
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
          messages: toUiMessages(resumeMessages),
          baseIndex: tab.historyBaseIndex,
          locale: getAgentLocale(),
          url: urlRef.current,
          kubeContext: kubeContextRef.current ?? undefined,
          diagramId: getActiveDiagramId() ?? undefined,
          credentialAccess,
          continueAfterInterruption: true,
          // Lets the backend treat this as an authorization resume: skip
          // memory recall (heaviest boot step) and use the approval nudge.
          resumeReason: 'approval-decision',
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)

          trackError(
            {
              source: 'agent_stream',
              phase: 'approval_resume_failed',
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
    } catch (err) {
      // Revert to approval-requested so the buttons reappear.
      setTabs((prev) =>
        prev.map((t) =>
          t.id !== tab.id
            ? t
            : {
                ...t,
                messages: t.messages.map((m) => ({
                  ...m,
                  parts: m.parts.map((p) =>
                    p.type === 'tool' && p.toolCallId === toolCallId && p.approval
                      ? {
                          ...p,
                          state: 'approval-requested' as const,
                          approval: { ...p.approval, approved: undefined },
                        }
                      : p,
                  ),
                })),
              },
        ),
      )
      toast.apiError('Could not record your decision', err)
    }
  })()
}
