import type { InboundFile } from '@/lib/agent/inbound-files'
import type {
  fetchSlackChannelHistory,
  fetchSlackChannelMembers,
  fetchSlackThreadReplies,
  SlackMember,
} from '@/lib/slack/api'
import type { SlackOutboundDestination } from '@/lib/slack/destinations'
import type { ObjectId } from 'mongodb'

export type SlackOutboundArgs = {
  userId: string
  teamId?: string | null
  /** The conversation the words are from: its Bot is named on each post. */
  sessionId: string
  /** Puts files fetched from Slack on the conversation's runtime; slack_read's files needs it. */
  placeFiles?: (files: InboundFile[]) => Promise<string[]>
}

export type SlackOutboundContext = {
  listDestinations: () => Promise<{
    ok: true
    workspace: { id: string; name: string }
    channels: {
      id: string
      name: string
      isPrivate: boolean
      slackWorkspaceId: string
      slackWorkspaceName: string
    }[]
    dmSelfAvailable: boolean
  }>
  post: (input: { destination: SlackOutboundDestination; text: string }) => Promise<
    | {
        ok: true
        destination: {
          type: SlackOutboundDestination['type']
          channelId: string
          label: string
        }
        messageTs: string
      }
    | { ok: false; error: string }
  >
  read: (input: {
    channelId: string
    slackWorkspaceId?: string
    threadTs?: string
    limit?: number
    cursor?: string
    oldest?: string
    latest?: string
    /** Put the page's attachments on the runtime and list their paths instead of Slack URLs. */
    files?: boolean
  }) => Promise<
    | {
        ok: true
        channel: { id: string; name: string }
        messages: Record<string, unknown>[]
        hasMore: boolean
        nextCursor?: string
        note?: string
      }
    | { ok: false; error: string }
  >
  members: (input: { channelId: string; slackWorkspaceId?: string; query?: string }) => Promise<
    | {
        ok: true
        channel: { id: string; name: string }
        members: SlackMember[]
        truncated: boolean
      }
    | { ok: false; error: string }
  >
}

export type SlackOutboundDependencies = {
  getBinding: (teamId: ObjectId) => Promise<{ slackTeamId: string; slackTeamName: string } | null>
  resolveBot: (
    teamId: ObjectId,
  ) => Promise<{ botToken: string; binding: { slackTeamId: string } } | null>
  // Enabled channel mappings pointing at this team — the grant that gives a
  // team without its own installation channel-scoped outbound access.
  listChannelGrants: (
    teamId: string,
  ) => Promise<{ slackWorkspaceId: string; slackChannelId: string }[]>
  resolveWorkspaceBot: (
    slackWorkspaceId: string,
  ) => Promise<{ botToken: string; workspaceName: string } | null>
  getSelfMapping: (
    slackWorkspaceId: string,
    teamId: string,
    userId: string,
    botToken: string,
  ) => Promise<{ slackUserId: string } | null>
  canViewPrivateChannels: (userId: string, teamId: string) => Promise<boolean>
  listChannels: (token: string) => Promise<{ id: string; name: string; isPrivate: boolean }[]>
  getChannel: (
    token: string,
    channelId: string,
  ) => Promise<{ id: string; name: string; isPrivate: boolean }>
  openDm: (token: string, slackUserId: string) => Promise<string>
  postMessage: (input: {
    token: string
    channel: string
    text: string
    threadTs?: string
    from: { sessionId: string; slackWorkspaceId: string }
  }) => Promise<{ channel?: string | { id?: string }; ts?: string }>
  /** Whether this conversation may post in the channel: a Bot's chat takes only its own Bots. */
  mayPostIn: (
    sessionId: string,
    slackWorkspaceId: string,
    slackChannelId: string,
  ) => Promise<boolean>
  readHistory: typeof fetchSlackChannelHistory
  readReplies: typeof fetchSlackThreadReplies
  listMembers: typeof fetchSlackChannelMembers
}

export type SlackWorkspaceGrant = {
  workspaceId: string
  workspaceName: string
  botToken: string
  channelIds: Set<string>
}

export type SlackTeamAccess = {
  // The team's own first-party installation: full workspace access plus DMs.
  installation: { workspaceId: string; workspaceName: string; botToken: string } | null
  // Channel mappings granted to this team in OTHER workspaces: posting is
  // strictly limited to the mapped channels, through that workspace's bot.
  grants: SlackWorkspaceGrant[]
}
