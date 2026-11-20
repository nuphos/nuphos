import { routeSlackDestination } from '@/lib/slack/agent-outbound/route-destination'

import type {
  SlackOutboundArgs,
  SlackOutboundContext,
  SlackOutboundDependencies,
  SlackTeamAccess,
} from '@/lib/slack/agent-outbound/types'

type Setup = {
  args: SlackOutboundArgs
  dependencies: SlackOutboundDependencies
  resolveAccess: () => Promise<SlackTeamAccess>
}

const MAX_MEMBERS = 200

// Opens a channel the way slack_post reaches it: the same access, the same routing,
// the same joined-channel check. A private channel's contents and members are for the
// people slack_list_destinations shows it to, so only an administrator.
async function openChannel(
  { args, dependencies, resolveAccess }: Setup,
  channelId: string,
  slackWorkspaceId: string | undefined,
): Promise<{ token: string; channel: { id: string; name: string } } | { error: string }> {
  const route = await routeSlackDestination({
    dependencies,
    access: await resolveAccess(),
    destination: { type: 'channel', channelId, ...(slackWorkspaceId ? { slackWorkspaceId } : {}) },
  })

  if (!route.ok) return { error: route.error }
  const channel = await dependencies.getChannel(route.sendToken, channelId)

  if (
    channel.isPrivate &&
    !(await dependencies.canViewPrivateChannels(args.userId, args.teamId!))
  ) {
    return { error: 'Only a team administrator can read a private Slack channel.' }
  }

  return { token: route.sendToken, channel: { id: channel.id, name: channel.name } }
}

function failure(err: unknown) {
  return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
}

export function createSlackOutboundRead(setup: Setup): SlackOutboundContext['read'] {
  const { dependencies } = setup

  return async ({ channelId, slackWorkspaceId, threadTs, ...page }) => {
    try {
      const open = await openChannel(setup, channelId, slackWorkspaceId)

      if ('error' in open) return { ok: false, error: open.error }
      const { token, channel } = open
      const read = threadTs
        ? await dependencies.readReplies({
            token,
            channel: channel.id,
            threadTs,
            ...(page.limit ? { maxMessages: page.limit } : {}),
          })
        : await dependencies.readHistory({ token, channel: channel.id, ...page })

      return { ok: true, channel, ...read }
    } catch (err) {
      return failure(err)
    }
  }
}

// Who is in a channel, so an agent can mention them as <@id>: names only, never
// emails, and only for a channel it could read.
export function createSlackOutboundMembers(setup: Setup): SlackOutboundContext['members'] {
  return async ({ channelId, slackWorkspaceId, query }) => {
    try {
      const open = await openChannel(setup, channelId, slackWorkspaceId)

      if ('error' in open) return { ok: false, error: open.error }
      const listed = await setup.dependencies.listMembers({
        token: open.token,
        channel: open.channel.id,
      })
      const needle = query?.trim().toLowerCase()
      const matches = needle
        ? listed.members.filter((member) =>
            [member.name, member.displayName, member.realName].some((name) =>
              name.toLowerCase().includes(needle),
            ),
          )
        : listed.members

      return {
        ok: true,
        channel: open.channel,
        members: matches.slice(0, MAX_MEMBERS),
        truncated: listed.truncated || matches.length > MAX_MEMBERS,
      }
    } catch (err) {
      return failure(err)
    }
  }
}
