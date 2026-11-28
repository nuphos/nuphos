import { createSlackPostBudget } from '@/lib/slack/agent-outbound/budget'
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

      let channelId: string
      let label: string

      if (input.destination.type === 'dm_self') {
        const selfMapping = await dependencies.getSelfMapping(
          sendWorkspaceId,
          args.teamId!,
          args.userId,
          sendToken,
        )

        if (!selfMapping) {
          return rejectBeforeDelivery(
            'Your Slack account is not linked to this Nuphos team, so I cannot DM you. Link it in Settings → Slack first.',
          )
        }
        channelId = await dependencies.openDm(sendToken, selfMapping.slackUserId)
        label = 'Slack DM'
      } else {
        const joined = await dependencies.getChannel(sendToken, input.destination.channelId)

        if (!(await dependencies.mayPostIn(args.sessionId, sendWorkspaceId, joined.id))) {
          return rejectBeforeDelivery(
            `#${joined.name} is another Bot's chat. Only that Bot and its Tasks post there.`,
          )
        }
        channelId = joined.id
        label = `#${joined.name}`
      }

      const text = input.text.trim()

      if (!commitAttempt()) return budget.overBudget()
      const response = await dependencies.postMessage({
        token: sendToken,
        channel: channelId,
        text,
        from: { sessionId: args.sessionId, slackWorkspaceId: sendWorkspaceId },
      })
      const messageTs = response.ts
      const responseChannel =
        typeof response.channel === 'string' ? response.channel : response.channel?.id

      if (!messageTs || !responseChannel) {
        throw new Error('Slack accepted the message but did not return its channel and timestamp')
      }

      return {
        ok: true,
        destination: { type: input.destination.type, channelId: responseChannel, label },
        messageTs,
      }
    } catch (err) {
      attempt.countUncommittedThrow()

      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
