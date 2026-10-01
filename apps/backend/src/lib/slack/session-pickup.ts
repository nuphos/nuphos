// "Pick up this conversation in Slack": bind an already-running conversation
// (typically desktop-started) to a fresh root message in the owner's Slack DM,
// so replies from a phone continue the same session. The heavy lifting already
// exists — slack_agent_threads drives inbound replies, and the Slack-bound
// branch in routes/agent mirrors desktop turns into the thread once a binding
// exists — so this module only creates the user-initiated binding itself.
//
// The thread lives in the owner's 1:1 DM with the bot, never a channel: a
// pickup is a private continuation of the owner's own conversation, and the DM
// reply path (assistant-message.ts) reuses an existing binding by design.
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'
import { bindSlackAgentThread, getSlackAgentThreadBySessionId } from '@/lib/slack/agent-bot'
import { postAgentSlackMessage } from '@/lib/slack/agent-message'
import { getSlackMessagePermalink, openSlackDm } from '@/lib/slack/api'
import { resolveSlackBotForTeam } from '@/lib/slack/installations'
import { resolveSlackSelfMapping } from '@/lib/slack/self-mapping'

import type { SlackAgentThread } from '@/lib/slack/agent-bot'

export type SlackSessionPickupThread = {
  workspaceId: string
  channelId: string
  threadTs: string
  url: string
}

export type SlackSessionPickupResult = {
  // 'already_bound' means the session had a Slack thread before this call
  // (a previous pickup, a slack_post root, or an incident notification) — the
  // caller gets its link instead of an error, since "continue in Slack" is
  // satisfied either way.
  status: 'bound' | 'already_bound'
  thread: SlackSessionPickupThread
}

export type SlackSessionPickupDependencies = {
  getThreadBySessionId: typeof getSlackAgentThreadBySessionId
  resolveBot: typeof resolveSlackBotForTeam
  getSelfMapping: typeof resolveSlackSelfMapping
  openDm: typeof openSlackDm
  postMessage: typeof postAgentSlackMessage
  bindThread: typeof bindSlackAgentThread
  getPermalink: typeof getSlackMessagePermalink
}

const defaultDependencies: SlackSessionPickupDependencies = {
  getThreadBySessionId: getSlackAgentThreadBySessionId,
  resolveBot: resolveSlackBotForTeam,
  getSelfMapping: resolveSlackSelfMapping,
  openDm: openSlackDm,
  postMessage: postAgentSlackMessage,
  bindThread: bindSlackAgentThread,
  getPermalink: getSlackMessagePermalink,
}

// Same construction the desktop's OpenSlackThreadButton falls back to, for
// when chat.getPermalink is unavailable.
function fallbackThreadUrl(workspaceId: string, channelId: string, threadTs: string): string {
  return `https://app.slack.com/client/${encodeURIComponent(workspaceId)}/${encodeURIComponent(channelId)}/thread/${encodeURIComponent(channelId)}-${encodeURIComponent(threadTs)}`
}

async function threadLink(
  thread: Pick<SlackAgentThread, 'slackWorkspaceId' | 'slackChannelId' | 'slackThreadTs'>,
  botToken: string,
  getPermalink: SlackSessionPickupDependencies['getPermalink'],
): Promise<SlackSessionPickupThread> {
  const permalink = await getPermalink(botToken, thread.slackChannelId, thread.slackThreadTs)

  return {
    workspaceId: thread.slackWorkspaceId,
    channelId: thread.slackChannelId,
    threadTs: thread.slackThreadTs,
    url:
      permalink ??
      fallbackThreadUrl(thread.slackWorkspaceId, thread.slackChannelId, thread.slackThreadTs),
  }
}

function pickupRootText(title: string): string {
  return [
    `**Picked up from Nuphos: ${title}**`,
    '',
    'Reply in this thread to continue the conversation. Turns driven from here run in the cloud sandbox — tools that execute on your computer (local shell, port forwards) are unavailable until you continue from the desktop app again.',
  ].join('\n')
}

/**
 * Bind the caller's conversation to a fresh DM root so it can be continued
 * from Slack. Idempotent: an existing binding is returned, not an error.
 * The caller must have verified that `userId` owns the conversation.
 */
export async function pickUpConversationInSlack(
  args: {
    userId: string
    teamId: string
    sessionId: string
    conversationTitle: string
  },
  dependencies: SlackSessionPickupDependencies = defaultDependencies,
): Promise<SlackSessionPickupResult> {
  const bot = await dependencies.resolveBot(new ObjectId(args.teamId))

  // The legacy shared-token fallback carries no workspace id, so there is no
  // workspace to look the user's Slack identity up in — treat it as not
  // installed rather than binding a thread nobody's replies can reach.
  if (!bot?.binding.slackTeamId) {
    throw new AppError(
      409,
      'slack_not_installed',
      'This team has no Slack workspace connected. Install the Nuphos Slack app first.',
    )
  }
  const slackWorkspaceId = bot.binding.slackTeamId
  const existing = await dependencies.getThreadBySessionId(args.sessionId)

  if (existing) {
    return {
      status: 'already_bound',
      thread: await threadLink(existing, bot.botToken, dependencies.getPermalink),
    }
  }
  const selfMapping = await dependencies.getSelfMapping({
    botToken: bot.botToken,
    slackWorkspaceId,
    teamId: args.teamId,
    nuphosUserId: args.userId,
  })

  if (!selfMapping) {
    throw new AppError(
      409,
      'slack_identity_unlinked',
      'Your Slack account is not linked to this Nuphos team. Link it in Settings → Slack first.',
    )
  }
  const dmChannelId = await dependencies.openDm(bot.botToken, selfMapping.slackUserId)
  const rootText = pickupRootText(args.conversationTitle)
  const response = await dependencies.postMessage({
    token: bot.botToken,
    channel: dmChannelId,
    text: rootText,
  })
  const rootTs = response.ts
  const responseChannel =
    typeof response.channel === 'string' ? response.channel : response.channel?.id

  if (!rootTs || !responseChannel) {
    throw new AppError(
      502,
      'slack_api_error',
      'Slack accepted the pickup message but did not return its channel and timestamp',
    )
  }

  try {
    const bound = await dependencies.bindThread({
      slackWorkspaceId,
      slackChannelId: responseChannel,
      slackThreadTs: rootTs,
      teamId: args.teamId,
      agentUserId: args.userId,
      sessionId: args.sessionId,
      createdBySlackUserId: selfMapping.slackUserId,
      origin: 'user_pickup',
      rootText,
    })

    logEvent('info', 'slack.session_pickup.bound', {
      session_id: args.sessionId,
      team_id: args.teamId,
      slack_workspace_id: slackWorkspaceId,
      slack_channel_id: bound.slackChannelId,
      slack_thread_ts: bound.slackThreadTs,
    })

    return {
      status: 'bound',
      thread: await threadLink(bound, bot.botToken, dependencies.getPermalink),
    }
  } catch (err) {
    // A concurrent pickup (double-click, phone + desktop at once) can win the
    // sessionId unique index between our existence check and this insert. The
    // user asked for a Slack thread and one exists — hand them the winner's.
    // The root this attempt posted stays in the DM unbound; replies under it
    // get the explain-unbound notice, which is the cheaper failure.
    const raced = await dependencies.getThreadBySessionId(args.sessionId).catch(() => null)

    if (raced) {
      return {
        status: 'already_bound',
        thread: await threadLink(raced, bot.botToken, dependencies.getPermalink),
      }
    }
    throw err
  }
}
