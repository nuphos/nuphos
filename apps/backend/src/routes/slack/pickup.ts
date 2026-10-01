// `/nuphos pickup` — continue a desktop conversation from Slack. The slash
// command lists the caller's recent conversations as an ephemeral picker; the
// button interaction binds the chosen session to a DM root (or reuses its
// existing thread) via the same pickup service the desktop button calls.
import { getConversationBySessionId, getConversations } from '@/lib/agent/db'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'
import { getSlackAgentThreadsBySessionIds } from '@/lib/slack/agent-bot'
import { postSlackResponseUrl } from '@/lib/slack/api'
import { resolveSlackBotForWorkspace } from '@/lib/slack/installations'
import { escapeSlackMrkdwn } from '@/lib/slack/mrkdwn'
import { pickUpConversationInSlack } from '@/lib/slack/session-pickup'
import { resolveSlackUserMapping } from '@/routes/slack/identity'

export const PICKUP_SESSION_ACTION = 'nuphos_pickup_session'

const PICKUP_LIST_LIMIT = 5

const NOT_LINKED_MESSAGE =
  'Your Slack account is not linked to Nuphos yet. Link it in Nuphos → Settings → Slack first.'

type PickupIdentity = {
  nuphosTeamId: string
  nuphosUserId: string
}

// Both entry points authenticate the same way the DM assistant flow does: the
// workspace installation names the team, and the Slack→Nuphos user mapping
// names the caller. Null means the caller was already answered.
async function resolvePickupIdentity(args: {
  botToken: string
  nuphosTeamId: string
  slackWorkspaceId: string
  slackUserId: string
}): Promise<PickupIdentity | null> {
  const { mapping } = await resolveSlackUserMapping(
    args.slackWorkspaceId,
    args.nuphosTeamId,
    args.slackUserId,
    args.botToken,
  )

  if (!mapping) return null

  return { nuphosTeamId: args.nuphosTeamId, nuphosUserId: mapping.nuphosUserId }
}

/**
 * The `/nuphos pickup` response: an ephemeral picker of the caller's most
 * recent conversations. Sessions that already have a Slack thread stay
 * listed — picking one hands back the existing thread's link.
 */
export async function buildPickupCommandResponse(args: {
  botToken: string
  nuphosTeamId: string
  slackWorkspaceId: string
  slackUserId: string
}): Promise<Record<string, unknown>> {
  const identity = await resolvePickupIdentity(args)

  if (!identity) {
    return { response_type: 'ephemeral', text: NOT_LINKED_MESSAGE }
  }
  const { conversations } = await getConversations(identity.nuphosUserId, {
    teamId: identity.nuphosTeamId,
    limit: PICKUP_LIST_LIMIT,
    archived: 'exclude',
  })

  if (conversations.length === 0) {
    return {
      response_type: 'ephemeral',
      text: 'You have no recent Nuphos conversations on this team to pick up.',
    }
  }
  const bound = new Set(
    (
      await getSlackAgentThreadsBySessionIds(
        conversations.map((conversation) => conversation.sessionId),
      ).catch(() => [])
    ).map((thread) => thread.sessionId),
  )
  const blocks: Record<string, unknown>[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Pick up a conversation* — I will open (or reuse) a DM thread you can continue from here.',
      },
    },
    ...conversations.map((conversation) => {
      const title = escapeSlackMrkdwn(conversation.title.trim() || 'New chat')
      const lastActive = Math.floor(conversation.lastActiveAt.getTime() / 1000)

      return {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${title}*\nLast active <!date^${String(lastActive)}^{date_short_pretty} {time}|recently>${bound.has(conversation.sessionId) ? ' · already in Slack' : ''}`,
        },
        accessory: {
          type: 'button',
          action_id: PICKUP_SESSION_ACTION,
          value: conversation.sessionId,
          text: {
            type: 'plain_text',
            text: bound.has(conversation.sessionId) ? 'Open thread' : 'Pick up',
          },
        },
      }
    }),
  ]

  return {
    response_type: 'ephemeral',
    text: 'Pick up a Nuphos conversation',
    blocks,
  }
}

/**
 * A picker button press. Detached from the interaction ack (the bind does
 * Slack + Mongo round-trips), reporting back through response_url — replacing
 * the picker so a double-tap has nothing left to press.
 */
export async function handlePickupSessionInteraction(args: {
  slackWorkspaceId: string
  slackUserId: string
  sessionId: string
  responseUrl: string
}): Promise<void> {
  const respond = async (text: string) => {
    await postSlackResponseUrl(args.responseUrl, {
      response_type: 'ephemeral',
      replace_original: true,
      text,
    })
  }

  try {
    const botContext = await resolveSlackBotForWorkspace(args.slackWorkspaceId)

    if (!botContext?.nuphosTeamId) {
      await respond('Nuphos is not fully installed for this Slack workspace yet.')

      return
    }
    const identity = await resolvePickupIdentity({
      botToken: botContext.botToken,
      nuphosTeamId: botContext.nuphosTeamId,
      slackWorkspaceId: args.slackWorkspaceId,
      slackUserId: args.slackUserId,
    })

    if (!identity) {
      await respond(NOT_LINKED_MESSAGE)

      return
    }
    // The sessionId is client-supplied button state: re-check that it names a
    // conversation this Slack user actually owns on this team before binding.
    const conversation = await getConversationBySessionId(args.sessionId)

    if (
      conversation?.userId !== identity.nuphosUserId ||
      (conversation.teamId ?? undefined) !== identity.nuphosTeamId
    ) {
      await respond('That conversation is not yours to pick up on this team.')

      return
    }
    const result = await pickUpConversationInSlack({
      userId: identity.nuphosUserId,
      teamId: identity.nuphosTeamId,
      sessionId: args.sessionId,
      conversationTitle: conversation.title.trim() || 'New chat',
    })

    await respond(
      result.status === 'already_bound'
        ? `This conversation already has a Slack thread: <${result.thread.url}|open it> and reply there.`
        : `Done — continue in <${result.thread.url}|your DM with Nuphos>.`,
    )
  } catch (err) {
    logError('slack.session_pickup.interaction_error', err, {
      slack_workspace_id: args.slackWorkspaceId,
      slack_user_id: args.slackUserId,
      session_id: args.sessionId,
    })
    await respond(
      err instanceof AppError
        ? err.message
        : 'Nuphos hit an error while picking up that conversation. Try again in a moment.',
    ).catch(() => {
      // The response_url itself failed; the error is already logged above.
    })
  }
}
