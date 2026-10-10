import type { AgentCredentialAccess } from './agent-credential-types.ts'
import type { AgentProvider } from '../types/runtime.ts'

/** Someone on a conversation: its owner, or a teammate who joined it. */
export type AgentConversationPerson = {
  id: string
  name: string
  email: string
  avatarURL?: string
  /** Former team member (removed, or account deleted) — render dimmed with a
   *  "Deactivated" tag. */
  deactivated?: boolean
}

/** Owner first, then whoever spoke here or was invited from Share. */
/** Who in the team may open a session without an invite. */
export type GeneralAccess = 'none' | 'view' | 'reply'
/** `manage` also moves the session to another runtime and changes its credentials. */
export type ParticipantRole = 'view' | 'reply' | 'manage'
export type ConversationAccess = 'owner' | ParticipantRole

export type AgentConversationParticipant = AgentConversationPerson & {
  isOwner: boolean
  role: ConversationAccess | null
}

export type ConversationAccessState = {
  generalAccess: GeneralAccess
  participants: AgentConversationParticipant[]
}

export type AgentConversation = {
  runtimeState?: import('../lib/runtimeExecution').RuntimeExecution
  sessionId: string
  teamId?: string
  title: string
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
  /** The owner or a manager: may change the runtime and credentials. */
  canManage?: boolean
  owner?: AgentConversationPerson
  credentialAccess?: AgentCredentialAccess
  transcriptUpdatedAt?: string
  createdAt: string
  lastActiveAt: string
  /** Owner-set archive marker; conversation stays intact and listable. */
  archivedAt?: string
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
  /** Watch group runs only: which monitored item fired behind the shared
   *  ingress that one partition trigger serves. */
  memberKey?: string
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

// One LLM-generated starter question shown on the agent home page after the
// team connects its first integration.
export type AgentStarterSuggestion = { title: string; prompt: string }

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
  sender: { type: 'user'; id: string; displayName: string; avatarURL?: string }
  source: 'nuphos' | 'slack' | 'discord' | 'lark'
  sentAt: string
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
  actor?: AgentTimelinePerson
  target?: AgentTimelinePerson
  from?: AgentTimelineRuntime
  to?: AgentTimelineRuntime
}

export type AgentConversationDetail = AgentConversation & {
  messages: AgentPersistedMessage[]
  /** Absolute transcript index of messages[0]; > 0 when fetched with `tail`
   *  and earlier messages exist (page backwards with
   *  agentGetConversationMessages). */
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
