// Native HITL: attach the AI SDK's `needsApproval` to server-executed tools so
// a command that needs authorization surfaces as a `tool-approval-request`
// stream part (the SDK pauses the turn, the client approves/denies inline, and
// on resubmit the SDK executes the tool itself). This REPLACES the custom
// gate (see gate.ts) — no sentinel result, no model re-issue, no /approve
// execute step. The decision engine (fast-path / policy / judge) is reused.
import { recordAgentEvent } from '@/lib/agent/db'
import { logError } from '@/lib/observability'

import { analyzeCommand } from './command-analysis'
import { decideAuthorization } from './decision'
import { makeBedrockJudge } from './judge'
import { commandFromInput, executedGovernedCommands, GOVERNED_TOOLS } from './session-context'
import { getEffectivePolicy, getSessionAuthState, hashCommand } from './store'

import type { AuthVerdict } from './types'
import type { AgentJournal } from '@/lib/agent/journal-capture'

export { commandFromInput, executedGovernedCommands }

export type AutoModeApprovalContext = {
  conversationId: string
  userId: string
  teamId?: string
  journal?: AgentJournal
  /** Governed-tool commands that already executed in this conversation
   *  (from the request transcript) — judge context, not approvals. */
  sessionCommands?: string[]
  /** Called when a command needs approval, so the turn ends as a clean
   *  turn-complete (not turn-paused → auto-resume): the client must wait for
   *  the user's approve/deny before resubmitting. */
  onRequireApproval?: () => void
  /** Emits an authorization-decision frame so the desktop can show which policy
   *  auto-authorized an allowed call (read-only / rule / judge). */
  emitDecision?: (payload: {
    decision: AuthVerdict['decision']
    toolName: string
    toolCallId: string
    reason: string
    layer: string
    suggestedRule?: string
    triggeredBy?: NonNullable<AuthVerdict['triggeredBy']>
  }) => void
}

/** Auto Mode is always on; kept as a function so the desktop `{ enabled }`
 *  contract and call sites read intent rather than a bare literal. */
export function isAutoModeApprovalEnabled(): boolean {
  return true
}

/** Decide whether a governed command needs the user's approval. Fail-safe:
 *  unreadable command (without bypass) or engine error → require approval. */
async function decide(
  ctx: AutoModeApprovalContext,
  judge: ReturnType<typeof makeBedrockJudge>,
  toolName: string,
  toolCallId: string,
  command: string | null,
): Promise<boolean> {
  let verdict: AuthVerdict

  if (command !== null && analyzeCommand(command).readOnly) {
    verdict = {
      decision: 'allow',
      layer: 'read_only_fastpath',
      reason: 'Read-only command — auto-allowed.',
      operation: 'read',
      triggeredBy: { kind: 'read_only' },
    }
  } else {
    // Once/always approvals ride in the message (native HITL); "approve for
    // session" grants and the Full Access flag persist per-conversation
    // and are matched here — exactly by the engine, by-effect by the judge
    // (retries with tweaked flags).
    const session = await getSessionAuthState(ctx.conversationId, ctx.userId)

    if (session.bypass) {
      verdict = await decideAuthorization({ enabled: true, bypass: true, command: command ?? '' })
    } else if (command === null) {
      return true // hid the command → require approval (fail-safe)
    } else {
      const policy = await getEffectivePolicy(ctx.userId)

      verdict = await decideAuthorization({
        enabled: true,
        command,
        policy,
        sessionCommands: ctx.sessionCommands,
        sessionApprovals: session.approvedCommands,
        judge,
      })
    }
  }

  void ctx.journal
    ?.authDecision({
      toolName,
      toolCallId,
      decision: verdict.decision,
      layer: verdict.layer,
      reason: verdict.reason,
      commandHash: hashCommand(command ?? ''),
    })
    .catch(() => {})
  recordAgentEvent({
    conversationId: ctx.conversationId,
    userId: ctx.userId,
    event: verdict.decision === 'require_auth' ? 'auth.required' : 'auth.allowed',
    data: {
      toolName,
      layer: verdict.layer,
      operation: verdict.operation ?? null,
      triggeredBy: verdict.triggeredBy?.kind ?? null,
      ruleId: verdict.triggeredBy?.kind === 'rule' ? (verdict.triggeredBy.ruleId ?? null) : null,
    },
  })
  ctx.emitDecision?.({
    decision: verdict.decision,
    toolName,
    toolCallId,
    reason: verdict.reason,
    layer: verdict.layer,
    suggestedRule: verdict.suggestedRule,
    triggeredBy: verdict.triggeredBy,
  })
  if (verdict.decision === 'require_auth') ctx.onRequireApproval?.()

  return verdict.decision === 'require_auth'
}

/** Set `needsApproval` on every governed tool. Callers already skip surfaces
 *  with no approve/deny UI (Slack/Lark) via the `isInApp` gate. */
export function attachAutoModeApproval<T extends Record<string, unknown>>(
  tools: T,
  ctx: AutoModeApprovalContext,
): T {
  const judge = makeBedrockJudge({
    userId: ctx.userId,
    sessionId: ctx.conversationId,
    teamId: ctx.teamId,
  })
  const wrapped: Record<string, unknown> = {}

  for (const [name, value] of Object.entries(tools)) {
    if (!GOVERNED_TOOLS.has(name) || !value || typeof value !== 'object') {
      wrapped[name] = value
      continue
    }
    wrapped[name] = {
      ...(value as object),
      needsApproval: async (input: unknown, opts: { toolCallId: string }) => {
        const command = commandFromInput(input)

        try {
          return await decide(ctx, judge, name, opts.toolCallId, command)
        } catch (err) {
          logError('agent.auto_mode.needs_approval_failed', err, {
            conversation_id: ctx.conversationId,
            user_id: ctx.userId,
          })

          return true // engine error → fail-safe to requiring approval
        }
      },
    }
  }

  return wrapped as T
}
