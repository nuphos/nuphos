import { claudeNotice, turnFailureCause } from '@/lib/claude-code-preview/openab-acp-errors'
import {
  AGENT_CLI_UNSTARTABLE_MESSAGE,
  userSetupFailure,
} from '@/lib/claude-code-preview/plain-failure'
import { runtimeLabel } from '@/lib/claude-code-preview/runtime-provider'
import { AppError } from '@/lib/errors'

import { getConversationBySessionId } from './db'
import { pushTimelineEvent } from './db/participants'
import { agentConversations } from './db/shared'

import type { AgentConversation } from './db'
import type { ReplyFailedCause } from './db/timeline-events'

/** Anthropic holds an account's replies until its holder verifies it, at the portal the notice links. */
const VERIFICATION_HOLD =
  /^(?:API Error: )?(Your account can['’]t receive replies from Claude\b.*)/u
const heldFor = (error: unknown) => VERIFICATION_HOLD.exec(claudeNotice(error) ?? '')?.[1]

/** How a Pi turn the model provider refused reads after `Internal error: ` (acp-shim.mjs). */
const PROVIDER_REFUSED = 'The model provider refused the request:'

/**
 * Why an agent could not reply, in words fit for the chat; undefined for an internal error,
 * except a model provider's refusal.
 */
function replyFailedReason(
  agent: AgentConversation | null,
  cause: ReplyFailedCause,
  error: unknown,
  resetsAt: string | undefined,
): string | undefined {
  const label = agent?.agentRuntime ? `${runtimeLabel(agent.agentRuntime)} ` : ''
  // Claude Code's own notice names the window and its reset in UTC: kept when no reading says when.
  const notice = resetsAt ? undefined : claudeNotice(error)
  const held = heldFor(error)

  if (cause === 'usage_limit' && held)
    return `its ${label}account must be verified with Anthropic (${held}).`
  if (cause === 'usage_limit')
    return notice
      ? `its ${label}account hit its usage limit (${notice}).`
      : `its ${label}account hit its usage limit.`
  if (cause === 'auth') return `its ${label}sign-in is no longer valid.`
  if (cause === 'cli') return AGENT_CLI_UNSTARTABLE_MESSAGE
  // A disabled agent's own message says where to move the conversation.
  if (error instanceof AppError && error.code === 'runtime_disabled') return error.message
  if (cause === 'offline') return `its ${label}runtime could not be reached.`

  if (error instanceof AppError) return error.message

  // A provider's refusal is written for people (and its keys redacted); an adapter's other
  // internal errors may name hosts or files, so they stay out of the chat.
  return notice?.startsWith(PROVIDER_REFUSED) ? notice.slice(0, 300) : undefined
}

async function usageResetsAtOf(agent: AgentConversation): Promise<string | undefined> {
  if (!agent.teamId || !agent.runtimeId) return undefined
  // Lazy so importing this does not pull in the runtime graph.
  const { usageResetsAt } = await import('@/lib/claude-code-preview/runtime-catalog')

  return usageResetsAt(agent.teamId, agent.userId, agent.runtimeId)
}

/** An agent a post woke could not reply: the channel says what happened and why, not just the log. */
export async function noteReplyFailed(channelId: string, agentId: string, error: unknown) {
  const agent = await getConversationBySessionId(agentId).catch(() => null)
  // A CLI that cannot start is the agent's own cause too: this computer's line offers Install.
  const cause: ReplyFailedCause =
    userSetupFailure(error) === 'agent_cli_unstartable' ? 'cli' : turnFailureCause(error)
  const resetsAt =
    // A held account comes back when its holder verifies it, not when its usage resets.
    cause === 'usage_limit' && agent && !heldFor(error)
      ? await usageResetsAtOf(agent).catch(() => undefined)
      : undefined
  const reason = replyFailedReason(agent, cause, error, resetsAt)

  await agentConversations()
    .updateOne(
      { sessionId: channelId },
      {
        $push: pushTimelineEvent({
          kind: 'agent_reply_failed',
          at: new Date(),
          actorId: 'system',
          agentId,
          agentName: agent?.title || 'Nuphos agent',
          cause,
          ...(reason ? { reason } : {}),
          ...(resetsAt ? { resetsAt } : {}),
        }),
      },
    )
    // The failure itself is already logged; a lost notice must not fail the post.
    .catch(() => undefined)
}
