import type { SlackOutboundDestination } from '@/lib/slack/destinations'
import type { ObjectId } from 'mongodb'

export type SlackOutboundArgs = {
  userId: string
  conversationId: string
  teamId?: string | null
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
  post: (input: {
    destination: SlackOutboundDestination
    text: string
    bindConversation: boolean
    /** Opens a replyable thread under the new root and gives it a conversation
     *  of its own. Takes precedence over bindConversation. */
    replyThread?: { text: string }
  }) => Promise<
    | {
        ok: true
        destination: {
          type: SlackOutboundDestination['type']
          channelId: string
          label: string
        }
        delivery: 'root'
        messageTs: string
        rootThreadTs: string
        threadBound: boolean
        /** Present when replyThread was requested. `opened: false` means the
         *  report was delivered but the thread is not replyable — reported, not
         *  raised: nothing about it is worth failing a delivered message over. */
        replyThread?: { opened: boolean; sessionId?: string; error?: string }
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
  getThreadBySessionId: (sessionId: string) => Promise<{ slackChannelId: string } | null>
  bindThread: (input: {
    slackWorkspaceId: string
    slackChannelId: string
    slackThreadTs: string
    teamId: string
    agentUserId: string
    sessionId: string
    createdBySlackUserId?: string
    rootText?: string
    notificationContext?: string
  }) => Promise<unknown>
  /** Records an outbound post into the bound thread's rolling transcript, so
   *  the addressing judge sees what the bot itself said there. Best-effort:
   *  callers must never turn a delivered message into a failure over it. */
  appendThreadMessage: (
    key: { slackWorkspaceId: string; slackChannelId: string; slackThreadTs: string },
    message: { ts: string; authorName: string; text: string; fromBot?: boolean },
  ) => Promise<void>
  /** The conversation a forked reply thread gets. Injected so a test can assert
   *  which session a thread was handed, rather than matching a random uuid. */
  newSessionId: () => string
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
  }) => Promise<{ channel?: string | { id?: string }; ts?: string }>
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
