import { db } from '@/lib/db'
import { tokenTeamFilter } from '@/lib/identity/token-team-scope'

import type { SessionResource } from '../session-resources'
import type { GeneralAccess } from './access'
import type { ChannelFields } from './channels'
import type { ConversationTaskState } from '../task-state'
import type { SettingsChange } from './settings-history'
import type { ConversationTimelineEvent } from './timeline-events'
import type { MessageMetadata } from '@/lib/agent/message-metadata'
import type { AgentMessageOrigin, AgentSessionOrigin } from '@/lib/agent/message-origin'
import type { AgentTokenUsageSummary } from '@/lib/agent/token-usage'
import type { RuntimeDefaults } from '@/lib/claude-code-preview/openab-acp-session'
import type { OpenAbProvider } from '@/lib/claude-code-preview/runtime-provider'
import type { SessionConfigOption } from '@/lib/claude-code-preview/session-config-options'
import type { PersonalCredentialProvider } from '@/models/personal-credentials'
import type { Collection, ObjectId } from 'mongodb'

export type BackgroundWorkLoss = 'session_lost' | 'unreachable'

export type ConversationPreviewAttachment = {
  forceNew?: boolean
  runtimeDefaults?: RuntimeDefaults
  sessionConfig?: SessionConfigOption[]
  openabSessionId: string
  runtimeUrl: string
}

// Legacy forceNew attachments name sessions the runtime never issued.
// Normalize them for every reader; the next prompt replaces the attachment.
export function liveAttachment(
  conversation: Pick<AgentConversation, 'claudeCodePreview'> | null | undefined,
): ConversationPreviewAttachment | null {
  const attachment = conversation?.claudeCodePreview

  return !attachment || attachment.forceNew ? null : attachment
}

// Desktop context MCP calls cannot carry themselves (they only know the conversation id).
export type ConversationPreviewContext = {
  diagramId?: string
  kubeContext?: string
  activeTurnKey?: string
  activeTurnOrigin?: AgentSessionOrigin
  localTools?: boolean
  secretCard?: boolean
  promptSuggestion?: string
}

export type AgentConversation = ConversationTaskState & {
  _id?: ObjectId
  sessionId: string // Frontend-generated UUID
  userId: string // Nuphos user id
  teamId?: string
  linkedResources?: SessionResource[]
  titleManuallySet?: boolean
  title: string
  avatar?: string
  avatarBackground?: string
  botTemplate?: {
    templateId: string
    version: string
    requirements: { provider: string; required: boolean; reason: string }[]
  }
  instructions?: string
  firstMessage: string
  messageCount: number
  transcriptUpdatedAt?: Date
  createdAt: Date
  lastActiveAt: Date
  // Archive marker, set by the owner. Archived conversations stay fully intact and
  // readable; list endpoints only hide them when asked (archived=exclude).
  archivedAt?: Date
  memberArchivedAt?: Record<string, Date> // By user id: someone else archived a shared Task for them alone.
  // When it was last un-archived by hand. The idle sweep counts from here as well as from
  // lastActiveAt, so a restored conversation is not filed away again an hour later.
  archiveRestoredAt?: Date
  // Teammates beside its owner, by speaking or by invite alike: it lists for them and they may
  // read it; reply follows its computer (access.ts). Older rows also carry unread managerIds.
  participantIds?: string[]
  generalAccess?: GeneralAccess | 'reply'
  timelineEvents?: ConversationTimelineEvent[]
  settingsHistory?: SettingsChange[]
  settingsRevision?: number
  activitySeq?: number
  watcherIds?: string[] // Who gets its push notifications; see watch.ts.
  readSeq?: number
  compactionSummary?: string
  compactionMessageCount?: number
  parentSessionId?: string // The managing conversation: create_thread's opener or set_thread_parent's choice.
  // Native Mongo parent reference. Legacy vendor fields stay stored but unused.
  conversationTraceParent?: string
  credentialAccess?: AgentCredentialAccess
  // Execution runtime is chosen once when the conversation is created and is
  // changed only by an explicit move. Team settings are defaults for NEW conversations;
  // they must never migrate an existing conversation between agent engines.
  agentRuntime?: OpenAbProvider
  runtimeId?: string
  runtimeLabel?: string
  previousRuntimeUrls?: string[]
  runtimeOperation?: { token: string; expiresAt: Date }
  runtimeMigration?: {
    fromRuntimeId?: string
    toRuntimeId: string
    movedAt: Date
    movedBy: string
  }
  runtimeFallback?: { failed: string[]; at: Date } // Agents a turn failed on, skipped for an hour
  // Claude Code preview attachment: which OpenAB session carries this
  // conversation, on which runtime endpoint. Durable so any backend replica
  // reattaches to the same inner session instead of forking a new one.
  claudeCodePreview?: ConversationPreviewAttachment
  initialSessionConfig?: RuntimeDefaults
  workspace?: { kind: 'folder'; path: string; runtimeId: string }
  claudeCodePreviewContext?: ConversationPreviewContext
  // What became of whatever the inner agent process left running — background
  // tasks, monitors, watchers. `session_lost` is a resume answering that the
  // inner session is gone; `unreachable` is reattachment giving up without
  // ever getting an answer, which is weaker and worded as such. Kept outside
  // `claudeCodePreview` so a re-attachment write cannot drop it, and durable
  // so the notice survives a backend replica roll. The next prompt consumes it.
  claudeCodePreviewWorkLost?: { at: Date; reason: BackgroundWorkLoss }
  botOnboarding?: 'pending' | 'active' | 'completed' | 'started'
  metadata?: {
    locale?: string
    provider?: string
    // Originating channel of the conversation ('app', 'mcp', 'slack.*',
    // 'slack.agent', 'agent.trigger'). Set on creation only.
    source?: string
    client?: AgentClientMeta
  }
  // The memory backend owning its recall, tools and ingest: stamped once at creation, immutable
  // (SPI decision 4 / A3), from resolveForNewSession. Not metadata.provider, the source channel.
  memoryProvider?: string
  // Sticky model fallback, set once when a turn first ends with finishReason 'content-filter':
  // every later turn here runs on toModelId instead of the primary, for the conversation's life.
  modelFallback?: {
    active: boolean
    reason: 'content-filter'
    firstTriggeredAt: Date
    fromModelId: string
    toModelId: string
  }
  tokenUsage?: AgentTokenUsageSummary
} & ChannelFields

// Which external client created the conversation (MCP callers): the OAuth
// client registration name is the strongest signal ("Claude Code", "Codex"),
// with the HTTP User-Agent as the fallback for raw-token callers.
export type AgentClientMeta = {
  name?: string
  oauthClientId?: string
  userAgent?: string
}

export type AgentCredentialAccess = {
  awsRoleIds: string[]
  gcpServiceAccountIds: string[]
  linodeAccountIds: string[]
  hetznerAccountIds: string[]
  tencentAccountIds?: string[]
  aliyunAccountIds?: string[]
  volcengineAccountIds?: string[]
  azureAccountIds?: string[]
  huaweiAccountIds?: string[]
  onpremClusterIds?: string[] // optional: older docs predate on-prem relay clusters
  betterStackIntegrationIds: string[]
  uptimeKumaInstanceIds: string[]
  // Optional for docs written before Linear joined the session-isolation tier.
  linearWorkspaceIds?: string[]
  jiraSiteIds: string[]
  asanaAccountIds: string[]
  // Optional for docs written before Sentry joined the session-isolation tier.
  sentryAccountIds?: string[]
  tailscaleClientIds: string[]
  zeaburIds: string[]
  vantaIntegrationIds: string[]
  secureframeIntegrationIds: string[]
  // Optional for docs written before Resend joined the session-isolation tier.
  resendIntegrationIds?: string[]
  trelloIntegrationIds?: string[]
  posthogIntegrationIds?: string[]
  plaudAccountIds?: string[]
  // Optional for docs written before these left self-discovery for selection.
  githubInstallationIds?: string[]
  gitlabBindingIds?: string[]
  grafanaInstanceIds?: string[]
  sonarqubeIntegrationIds?: string[]
  notionIntegrationIds?: string[]
  upstashAccountIds?: string[]
  cloudflareAccountIds?: string[]
  instaboxAccountIds?: string[]
  // Optional for docs older than device selection; devices are user-owned, never team-shared.
  deviceIds?: string[]
  teamIdentity?: ('github' | 'linear')[] // act as the team, not a member's Personal Credential
  personalCredentialIds?: PersonalCredentialProvider[] // the owner's own, with no team binding
  updatedAt: Date
  updatedBy: string
}

export type AgentMessage = {
  _id?: ObjectId
  sessionId: string
  userId: string
  messageId: string
  index: number
  role: 'user' | 'assistant'
  parts: unknown[]
  turnOrigin?: 'autonomous'
  turnKind?: 'plan-approval'
  // Where this specific message came in from, for messages that arrived over an
  // external bridge. Absent for messages typed in Nuphos and for every message
  // written before this field existed — additive, so no migration.
  metadata?: MessageMetadata
  origin?: AgentMessageOrigin
  feedback?: AgentMessageFeedback
  createdAt: Date
  updatedAt: Date
}

// Viewer reaction to an assistant message. One feedback per message — a later
// vote (or the optional comment from the thumbs-down dialog) replaces it.
export type AgentMessageFeedback = {
  rating: 'up' | 'down'
  comment?: string
  userId: string
  updatedAt: Date
}

// Persistent agent event trail — first-class data alongside conversations and
// messages (no TTL). One document per event; `event` is a namespaced key
// ('sandbox.created', 'memory.updated', 'credentials.accessed', …) and
// domain-specific payload lives under `data`, so new event families need no
// schema change.
export type AgentEventDoc = {
  _id?: ObjectId
  conversationId: string
  event: string
  ts: Date
  replicaId: string
  userId?: string
  data?: Record<string, unknown>
}

const COLLECTION_NAME = 'agent_conversations'
const MESSAGE_COLLECTION_NAME = 'agent_messages'
const EVENT_COLLECTION_NAME = 'agent_events'

export const agentConversations = (): Collection<AgentConversation> =>
  db().collection<AgentConversation>(COLLECTION_NAME)

export const agentMessages = (): Collection<AgentMessage> =>
  db().collection<AgentMessage>(MESSAGE_COLLECTION_NAME)

export const agentEvents = (): Collection<AgentEventDoc> =>
  db().collection<AgentEventDoc>(EVENT_COLLECTION_NAME)

// Keep legacy user rows reachable, but scope conversation tokens strictly to their own team.
export function withTeamScope(
  base: Record<string, unknown>,
  teamId: string | undefined,
): Record<string, unknown> {
  const tokenTeam = tokenTeamFilter(teamId)

  if (tokenTeam !== undefined) return { ...base, teamId: tokenTeam }
  if (!teamId) return base

  return { ...base, $or: [{ teamId }, { teamId: { $exists: false } }] }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
