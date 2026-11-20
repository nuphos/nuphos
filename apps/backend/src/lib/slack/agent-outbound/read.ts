import { routeSlackDestination } from '@/lib/slack/agent-outbound/route-destination'

import type {
  SlackOutboundArgs,
  SlackOutboundContext,
  SlackOutboundDependencies,
  SlackTeamAccess,
} from '@/lib/slack/agent-outbound/types'

// Reads a channel the way slack_post reaches it: the same access, the same
// routing, the same joined-channel check. A private channel's contents are for
// the people slack_list_destinations shows it to, so only an administrator.
export function createSlackOutboundRead(setup: {
  args: SlackOutboundArgs
  dependencies: SlackOutboundDependencies
  resolveAccess: () => Promise<SlackTeamAccess>
}): SlackOutboundContext['read'] {
  const { args, dependencies, resolveAccess } = setup

  return async ({ channelId, slackWorkspaceId, threadTs, ...page }) => {
    try {
      const route = await routeSlackDestination({
        dependencies,
        access: await resolveAccess(),
        destination: {
          type: 'channel',
          channelId,
          ...(slackWorkspaceId ? { slackWorkspaceId } : {}),
        },
      })

      if (!route.ok) return { ok: false, error: route.error }
      const token = route.sendToken
      const channel = await dependencies.getChannel(token, channelId)

      if (
        channel.isPrivate &&
        !(await dependencies.canViewPrivateChannels(args.userId, args.teamId!))
      ) {
        return { ok: false, error: 'Only a team administrator can read a private Slack channel.' }
      }
      const read = threadTs
        ? await dependencies.readReplies({
            token,
            channel: channel.id,
            threadTs,
            ...(page.limit ? { maxMessages: page.limit } : {}),
          })
        : await dependencies.readHistory({ token, channel: channel.id, ...page })

      return { ok: true, channel: { id: channel.id, name: channel.name }, ...read }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
