import { createSlackPostBudget } from '@/lib/slack/agent-outbound/budget'
import { finalizeSlackPostDelivery } from '@/lib/slack/agent-outbound/finalize-delivery'
import { routeSlackDestination } from '@/lib/slack/agent-outbound/route-destination'

import type {
  SlackOutboundArgs,
  SlackOutboundContext,
  SlackOutboundDependencies,
  SlackTeamAccess,
} from '@/lib/slack/agent-outbound/types'

export function createSlackOutboundPost(setup: {
  args: SlackOutboundArgs
  dependencies: SlackOutboundDependencies
  resolveAccess: () => Promise<SlackTeamAccess>
}): SlackOutboundContext['post'] {
  const { args, dependencies, resolveAccess } = setup
  const budget = createSlackPostBudget()

  return async (input) => {
    // The fork owns the thread, so binding this conversation to the same root
    // would be a second claim on it. replyThread wins — bindConversation
    // defaults to true and the model should not have to turn it off.
    const forkThread = input.replyThread
    const bindCurrentConversation = input.bindConversation && !forkThread
    const rejectedEarly = budget.beginCall()

    if (rejectedEarly) return rejectedEarly
    const attempt = budget.newAttempt()
    const { commitAttempt, rejectBeforeDelivery } = attempt

    try {
      const access = await resolveAccess()
      const route = await routeSlackDestination({
        dependencies,
        access,
        destination: input.destination,
      })

      if (!route.ok) return rejectBeforeDelivery(route.error)
      const { sendToken, sendWorkspaceId } = route
      const selfMapping = await dependencies.getSelfMapping(
        sendWorkspaceId,
        args.teamId!,
        args.userId,
        sendToken,
      )

      let channelId: string
      let label: string

      if (input.destination.type === 'dm_self') {
        if (!selfMapping) {
          return rejectBeforeDelivery(
            'Your Slack account is not linked to this Nuphos team, so I cannot DM you. Link it in Settings → Slack first.',
          )
        }
        channelId = await dependencies.openDm(sendToken, selfMapping.slackUserId)
        label = 'Slack DM'
      } else {
        const joined = await dependencies.getChannel(sendToken, input.destination.channelId)

        channelId = joined.id
        label = `#${joined.name}`
      }

      const text = input.text.trim()

      if (bindCurrentConversation) {
        const existing = await dependencies.getThreadBySessionId(args.conversationId)

        if (existing) {
          return rejectBeforeDelivery(
            `This conversation is already bound to Slack channel ${existing.slackChannelId}. Do not post another replyable root message.`,
          )
        }
      }

      if (!commitAttempt()) return budget.overBudget()
      const response = await dependencies.postMessage({
        token: sendToken,
        channel: channelId,
        text,
      })
      const messageTs = response.ts
      const responseChannel =
        typeof response.channel === 'string' ? response.channel : response.channel?.id

      if (!messageTs || !responseChannel) {
        throw new Error('Slack accepted the message but did not return its channel and timestamp')
      }

      return await finalizeSlackPostDelivery({
        dependencies,
        userId: args.userId,
        teamId: args.teamId!,
        conversationId: args.conversationId,
        destinationType: input.destination.type,
        label,
        text,
        sendToken,
        sendWorkspaceId,
        channelId,
        responseChannel,
        messageTs,
        selfMapping,
        bindCurrentConversation,
        forkThread,
      })
    } catch (err) {
      attempt.countUncommittedThrow()

      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
