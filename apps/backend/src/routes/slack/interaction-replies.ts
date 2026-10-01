import { logError, logEvent } from '@/lib/observability'
import { postSlackEphemeral, postSlackResponseUrl } from '@/lib/slack/api'

type InteractionReplierEvents = {
  noResponseUrl: string
  responseUrlError: string
  rejected: string
  ephemeralError: string
}

export type InteractionRepliers = {
  reply: (body: Record<string, unknown>) => Promise<void>
  reject: (reason: string, text: string, extra?: Record<string, unknown>) => Promise<void>
  ephemeral: (text: string) => Promise<void>
  setBotToken: (token: string) => void
}

/**
 * Delivery helpers shared by the detached card-decision handlers (plan
 * approve, permission approve/reject). All best-effort: a failed post must not
 * throw out of a detached handler, so failures are logged and swallowed.
 *
 * `reply` posts to the card's response_url; without one it can only log.
 * `reject` is BOTH user-visible and logged — a decision click that dies must
 * never be invisible in telemetry. Rejections land in-thread via
 * chat.postEphemeral once the bot token is known (`setBotToken`); response_url
 * (a channel-root ephemeral) is the fallback for the pre-token paths and
 * postEphemeral failures.
 */
export function createInteractionRepliers(args: {
  slackWorkspaceId: string
  slackUserId: string
  responseUrl?: string
  channelId?: string
  threadTs?: string
  events: InteractionReplierEvents
  /** Extra fields (e.g. the decision) merged into every rejected-event log. */
  rejectLogExtra?: Record<string, unknown>
}): InteractionRepliers {
  let botToken: string | null = null

  const reply = async (body: Record<string, unknown>) => {
    if (!args.responseUrl) {
      logEvent('warn', args.events.noResponseUrl, {
        slack_workspace_id: args.slackWorkspaceId,
        slack_user_id: args.slackUserId,
      })

      return
    }
    try {
      await postSlackResponseUrl(args.responseUrl, body)
    } catch (err) {
      logError(args.events.responseUrlError, err, {
        slack_workspace_id: args.slackWorkspaceId,
        slack_user_id: args.slackUserId,
      })
    }
  }
  const ephemeral = async (text: string) => {
    if (botToken && args.channelId) {
      try {
        await postSlackEphemeral({
          token: botToken,
          channel: args.channelId,
          user: args.slackUserId,
          text,
          threadTs: args.threadTs,
        })

        return
      } catch (err) {
        logError(args.events.ephemeralError, err, {
          slack_workspace_id: args.slackWorkspaceId,
          slack_user_id: args.slackUserId,
        })
      }
    }
    await reply({ response_type: 'ephemeral', replace_original: false, text })
  }
  const reject = async (reason: string, text: string, extra: Record<string, unknown> = {}) => {
    logEvent('warn', args.events.rejected, {
      reason,
      ...(args.rejectLogExtra ?? {}),
      slack_workspace_id: args.slackWorkspaceId,
      slack_user_id: args.slackUserId,
      ...extra,
    })
    await ephemeral(text)
  }

  return {
    reply,
    reject,
    ephemeral,
    setBotToken: (token: string) => {
      botToken = token
    },
  }
}
