import { withOutdatedHint } from '@/lib/claude-code-preview/host-minimum-version'
import { claudeNotice, turnFailureCause } from '@/lib/claude-code-preview/openab-acp-errors'
import {
  AGENT_CLI_UNSTARTABLE_MESSAGE,
  userSetupFailure,
} from '@/lib/claude-code-preview/plain-failure'
import { runtimeLabel } from '@/lib/claude-code-preview/runtime-provider'
import { AppError } from '@/lib/errors'
import { notifyNudge } from '@/lib/push/notify'

import { getConversationBySessionId } from './db'
import { clearReplyFailed, pushTimelineEvent } from './db/participants'
import { agentConversations } from './db/shared'

import type { AgentConversation } from './db'
import type { ReplyFailedCause } from './db/timeline-events'
import type { Collection } from 'mongodb'

/**
 * Anthropic holds an account's replies until its holder verifies it: where, from the notice.
 * Only Anthropic's portal is taken, so a client never opens another address it names.
 */
const VERIFICATION_HOLD =
  /^(?:API Error: )?Your account can['’]t receive replies from Claude\b.*?(https:\/\/portal\.anthropic\.com\/\S*)?$/u
const verifyUrlFor = (error: unknown) => {
  const held = VERIFICATION_HOLD.exec(claudeNotice(error) ?? '')

  return held && (held[1] ?? 'https://portal.anthropic.com/')
}

/** How a Pi turn the model provider refused reads after `Internal error: ` (acp-shim.mjs). */
const PROVIDER_REFUSED = 'The model provider refused the request:'

/**
 * Why an agent could not reply, in words fit for the chat. Other internal errors than a model
 * provider's refusal may name hosts or files, so they say only that the runtime failed.
 */
function replyFailedReason(
  agent: AgentConversation | null,
  cause: ReplyFailedCause,
  error: unknown,
  resetsAt: string | undefined,
): string {
  const label = agent?.agentRuntime ? `${runtimeLabel(agent.agentRuntime)} ` : ''
  // Claude Code's own notice names the window and its reset in UTC: kept when no reading says when.
  const notice = resetsAt ? undefined : claudeNotice(error)

  if (cause === 'usage_limit' && verifyUrlFor(error))
    return `its ${label}account must be verified with Anthropic.`
  if (cause === 'usage_limit')
    return notice
      ? `its ${label}account hit its usage limit (${notice}).`
      : `its ${label}account hit its usage limit.`
  if (cause === 'auth') return `its ${label}sign-in is no longer valid.`
  if (cause === 'cli') return AGENT_CLI_UNSTARTABLE_MESSAGE
  // A disabled or gone agent's own message says where to move the conversation.
  if (error instanceof AppError && ['runtime_disabled', 'runtime_not_found'].includes(error.code))
    return error.message
  if (cause === 'offline') return `its ${label}runtime could not be reached.`

  if (error instanceof AppError) return error.message

  return notice?.startsWith(PROVIDER_REFUSED)
    ? notice.slice(0, 300)
    : `its ${label}runtime ran into an error.`
}

/** How long a Bot's owner, once told its agent is signed out, is not told again. */
const SIGNED_OUT_NOTICE_MS = 6 * 3_600_000

/** The one field this file keeps on a Bot: when its owner was last told it is signed out. */
const signedOutNotices = () =>
  agentConversations() as unknown as Collection<{ sessionId: string; signedOutNoticeAt?: Date }>

/**
 * #4179: a channel reply failed because the Bot is signed out, and its owner may not be in
 * that channel. They are told the way a Trigger paused for a sign-in tells its owner (#3195),
 * once, and not again for SIGNED_OUT_NOTICE_MS however often the channel wakes it.
 */
async function tellOwnerSignedOut(
  agent: AgentConversation,
  reason: string,
  notify: typeof notifyNudge,
) {
  if (!agent.teamId) return
  const now = new Date()
  const claimed = await signedOutNotices().updateOne(
    {
      sessionId: agent.sessionId,
      $or: [
        { signedOutNoticeAt: { $exists: false } },
        { signedOutNoticeAt: { $lt: new Date(now.getTime() - SIGNED_OUT_NOTICE_MS) } },
      ],
    },
    { $set: { signedOutNoticeAt: now } },
  )

  if (claimed.modifiedCount === 0) return
  notify([agent.userId], {
    sessionId: agent.sessionId,
    teamId: agent.teamId,
    title: 'Bot signed out',
    body: `${agent.title || 'Nuphos agent'} could not reply in a channel: ${reason} Sign the agent in again.`,
  })
}

/** When the agent's spent usage is back, if its runtime reports it. */
export async function usageResetsAtOf(
  agent: Pick<AgentConversation, 'teamId' | 'userId' | 'runtimeId'>,
): Promise<string | undefined> {
  if (!agent.teamId || !agent.runtimeId) return undefined
  // Lazy so importing this does not pull in the runtime graph.
  const { usageResetsAt } = await import('@/lib/claude-code-preview/runtime-catalog')

  return usageResetsAt(agent.teamId, agent.userId, agent.runtimeId)
}

/** An agent a post woke could not reply: the channel keeps one line per agent saying why, the latest. */
export async function noteReplyFailed(
  channelId: string,
  agentId: string,
  error: unknown,
  notify = notifyNudge,
) {
  const agent = await getConversationBySessionId(agentId).catch(() => null)
  // A CLI that cannot start is the agent's own cause too: this computer's line offers Install.
  const cause: ReplyFailedCause =
    userSetupFailure(error) === 'agent_cli_unstartable' ? 'cli' : turnFailureCause(error)
  const resetsAt =
    // A held account comes back when its holder verifies it, not when its usage resets.
    cause === 'usage_limit' && agent && !verifyUrlFor(error)
      ? await usageResetsAtOf(agent).catch(() => undefined)
      : undefined
  const reason = withOutdatedHint(replyFailedReason(agent, cause, error, resetsAt), error)
  const verifyUrl = cause === 'usage_limit' ? verifyUrlFor(error) : null

  try {
    await clearReplyFailed(channelId, agentId)
    await agentConversations().updateOne(
      { sessionId: channelId },
      {
        $set: { transcriptUpdatedAt: new Date() },
        $push: pushTimelineEvent({
          kind: 'agent_reply_failed',
          at: new Date(),
          actorId: 'system',
          agentId,
          agentName: agent?.title || 'Nuphos agent',
          cause,
          ...(reason ? { reason } : {}),
          ...(resetsAt ? { resetsAt } : {}),
          ...(verifyUrl ? { verifyUrl } : {}),
        }),
      },
    )
  } catch {
    // The failure itself is already logged; a lost notice must not fail the post.
  }
  if (cause === 'auth' && agent && reason)
    await tellOwnerSignedOut(agent, reason, notify).catch(() => undefined)
}
