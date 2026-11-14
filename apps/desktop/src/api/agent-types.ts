import type { AgentCredentialAccess } from './agent-credential-types.ts'
import type { AgentMessageMention } from './mention-types.ts'
import type { SessionResource } from './session-resource-types'
import type { AgentProvider } from '../types/runtime.ts'

export type { AgentMessageMention, ChannelMention } from './mention-types.ts'

/** The message a message replies to, e.g. a Discord reply; `id` is a channel post's. */
export type AgentMessageReply = { id?: string; authorName: string; text: string }

/** Someone on a conversation: its owner, or a teammate who joined it. */
export type AgentConversationPerson = {
  id: string
  name: string
  email: string
  avatarURL?: string
  /** Former team member (removed, or account deleted) — render dimmed with a "Deactivated" tag. */
  deactivated?: boolean
}

/** Owner first, then whoever spoke here or was invited from Share. */
/** Who in the team may open a session without an invite; only a chat offers 'reply'. */
export type GeneralAccess = 'none' | 'view' | 'reply'
/** Who would lose reply if the session moved to a runtime: they cannot use its computer. */
export type ConversationMoveCheck = {
  computer: { deviceId: string; label: string } | null
  losing: { id: string; name: string }[]
  /** The mover owns or manages that computer, so confirming gives them use of it. */
  canGrant: boolean
}

/** A participant replies while they may use the computer the session runs on; else they read. */
export type ConversationAccess = 'owner' | 'reply' | 'view'

/** What makes a person an agent: the face it shows, and whether this viewer may take it out. */
export type AgentFace = { avatar?: string; provider?: AgentProvider; removable?: boolean }

export type AgentConversationParticipant = AgentConversationPerson & {
  isOwner: boolean
  role: ConversationAccess | null
  /** Set on a channel's agent, which the Share card lists among its people. */
  agent?: AgentFace
}

export type ConversationAccessState = {
  generalAccess: GeneralAccess
  participants: AgentConversationParticipant[]
}

/** An agent in a channel: its session, which is the agent. */
export type ChannelAgent = AgentFace & { sessionId: string; title: string; ownerId: string }

/** A member a chat's icon shows (up to two, whoever spoke last first): a person, or an agent by its session. */
export type ChannelFace = {
  id: string
  name: string
  avatarURL?: string
  agent?: { avatar?: string; provider?: AgentProvider }
}

export type AgentConversation = {
  /** A channel: a place where people and agents talk. It runs no agent of its own. */
  kind?: 'channel'
  /** Started as a group chat: never a Bot's 1:1 chat, even with one Bot in it. */
  group?: true
  faces?: ChannelFace[]
  /** A channel's agents, as their session ids. */
  agentSessionIds?: string[]
  runtimeState?: import('../lib/runtimeExecution').RuntimeExecution
  linkedResources?: SessionResource[]
  sessionId: string
  teamId?: string
  title: string
  /** Picked bot avatar, e.g. `05-rembrandt`. Absent: the one its sessionId selects. */
  avatar?: string
  firstMessage: string
  messageCount: number
  tokenUsage?: AgentTokenUsageSummary
  /** Stable, server-normalized creation origin plus any linked Slack surface. */
  activitySource?: AgentConversationActivitySource
  /** Present when a trigger fired this conversation. Such conversations are a
   *  Trigger's run history and never appear in Chats. */
  triggerRun?: AgentConversationTriggerRun
  isOwner?: boolean
  readOnly?: boolean
  /** The owner: may change the runtime and credentials. */
  canManage?: boolean
  owner?: AgentConversationPerson
  credentialAccess?: AgentCredentialAccess
  transcriptUpdatedAt?: string
  createdAt: string
  lastActiveAt: string
  /** Owner-set archive marker; conversation stays intact and listable. */
  archivedAt?: string
  /** The conversation that opened this one as a thread; the sidebar nests it there. */
  parentSessionId?: string
  workspace?: { kind: 'folder'; path: string; runtimeId: string } // Its project folder
  /** This viewer gets its push notifications. Absent from a backend that predates watching. */
  watching?: boolean
  /** This conversation is backed by a long-lived Claude Code runtime session. */
  claudeCodeRuntimeAttached?: boolean
  agentRuntime?: AgentProvider
  runtimeId?: string
  runtimeLabel?: string
  /** A reply running right now, on any client. */
  activeRun?: { streamId: string; startedAt: string | null } | null
  /** Owner-only: assistant turn boundaries so far, and how many were read on any device. */
  activitySeq?: number
  readSeq?: number
  /** Every open question, oldest first; Desktop resolves each by id after a reply or dismissal. */
  inputRequests?: AgentInputRequest[]
  /** Someone asked who can sign this conversation's agent in; their message waits for it. */
  signInRequest?: AgentSignInRequest
  /** The newest message, for the row's preview: raw markdown cut short, empty for files only.
   *  `from` names its sender in a group chat, unless it was the viewer. */
  lastMessage?: { text: string; from?: string }
}

export type AgentSignInRequest = {
  runtimeId: string
  requesterId: string
  requesterName: string
  askedUserIds: string[]
  askedName: string
  askedAt: string
}

export type AgentInputRequest = {
  /** The request_user_decision tool call id. */
  id: string
  category: string
  question: string
  /** Markdown the agent wrote so the question can be decided without the chat. */
  body?: string
  options?: string[]
  /** Any number of `options` may be picked. */
  multiSelect?: boolean
  /** Related questions answered together; `question` is their headline. */
  questions?: { question: string; options?: string[]; multiSelect?: boolean }[]
  /** The secret a `credential` request asks for, the providers an `integration` one connects (any access) or the member's own credentials it asks for (only selecting one answers), or the plan it approves. */
  secretName?: string
  providers?: string[]
  credentials?: { provider: 'personal'; id: 'github' | 'linear' }[]
  planId?: string
  askedAt: string
  status: 'open' | 'answered' | 'dismissed'
}

export type AgentConversationActivitySource = {
  origin: 'nuphos' | 'slack' | 'trigger' | 'mcp' | 'unknown'
  linkedSlackThread: boolean
}

/** How a trigger fired, recorded per run so a schedule, a provider webhook and
 *  a Run-now press are distinguishable in the Trigger's run list. */
export type AgentTriggerRunKind = 'scheduled' | 'webhook' | 'manual'

export type AgentConversationTriggerRun = {
  id: string
  kind?: AgentTriggerRunKind
}

export type AgentTokenUsageSummary = {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
  /** Cache-WRITE tokens: a subset of inputTokens billed at a premium
   *  (1.25x input). Absent on conversations recorded before cache-write
   *  accounting shipped. */
  cacheWriteTokens?: number
  recordCount: number
  modelCallCount: number
  toolCallCount: number
  providers: AgentTokenUsageProviderTotal[]
  costUsd?: number
  lastRecordedAt?: string
}

export type AgentTokenUsageProviderTotal = {
  provider: string
  modelId: string
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  recordCount: number
  costUsd?: number
}

export type AgentSlackThread = {
  workspaceId: string
  channelId: string
  threadTs: string
  url: string | null
}

export type {
  AgentConversationCredentialsResponse,
  AgentCredentialAccess,
  AgentCredentialOptions,
  AgentCredentialSelection,
} from './agent-credential-types.ts'

export type AgentActiveRun = {
  streamId: string
  startedAt: string | null
}

export type AgentMessageMetadata = {
  version: 1
  sender: {
    type: 'user' | 'agent' | 'system'
    id: string
    displayName: string
    avatarURL?: string
    agentRuntime?: AgentProvider
    /** An agent token's message: the user it acts for. */
    onBehalfOf?: { id: string; displayName: string }
  }
  source: 'nuphos' | 'slack' | 'discord' | 'lark' | 'agent.thread' | 'agent.resource'
  sentAt: string
  /** The session an agent.thread message came from. */
  sourceSessionId?: string
  /** The message this one replies to. */
  replyTo?: AgentMessageReply
  /** A Discord author with no verified Nuphos identity; the name is theirs to choose. */
  unattested?: true
  /** Teammates it @mentions, as the server resolved them. */
  mentions?: AgentMessageMention[]
}

export type AgentPersistedMessage = {
  metadata?: AgentMessageMetadata
  id: string
  role: 'user' | 'assistant'
  parts: unknown[]
  turnOrigin?: 'autonomous'
  turnKind?: 'plan-approval'
  stoppedByUser?: boolean
  /** ISO time the message was first persisted — turn start for user
   *  messages, turn end for assistant messages. */
  createdAt?: string
  /** Viewer's stored reaction to this assistant message. */
  feedback?: 'up' | 'down'
}

export type AgentTimelinePerson = { id: string; name: string; avatarURL: string }
export type AgentTimelineRuntime = { label: string; provider?: AgentProvider }

/** Who joined, left or moved the session; `text` is the whole line, plain. */
export type AgentTimelineEvent = {
  kind: string
  at: string
  text: string
  /** agents_paused: the turn budget the channel's agents used up. */
  turns?: number
  actor?: AgentTimelinePerson
  target?: AgentTimelinePerson
  from?: AgentTimelineRuntime
  to?: AgentTimelineRuntime
  /** Set when a fallback moved the session: its agent was low on usage, unreachable, or failed a turn. */
  reason?: 'quota' | 'offline' | 'failure'
  /** A fallback that found no agent: each one passed over, and why. */
  skipped?: { label: string; reason: string }[]
  /** message_edited / conversation_forked: the destination session. */
  forkSessionId?: string
}

export type AgentConversationDetail = AgentConversation & {
  messages: AgentPersistedMessage[]
  /** Absolute transcript index of messages[0]; > 0 when fetched with `tail` and earlier
   *  messages exist (page backwards with agentGetConversationMessages). */
  messagesFirstIndex?: number
  runtimeState?: import('../lib/runtimeExecution').RuntimeExecution
  transcriptUpdatedAt?: string | null
  activeRun?: AgentActiveRun | null
  slackThread?: AgentSlackThread | null
  timelineEvents?: AgentTimelineEvent[]
  /** The runtime's guess at the next prompt, offered in the composer. */
  promptSuggestion?: string | null
}

export type AgentConversationMessagesPage = {
  messages: AgentPersistedMessage[]
  firstIndex: number
}

export type AgentConversationsPage = {
  conversations: AgentConversation[]
  nextCursor: string | null
  hasMore: boolean
}
