import { db } from '@/lib/db'

import type { MessageMetadata } from '@/lib/agent/message-metadata'
import type { AgentMessageOrigin } from '@/lib/agent/message-origin'
import type { AgentTokenUsageSummary } from '@/lib/agent/token-usage'
import type { AgentSessionOrigin } from '@/lib/agent/tools-triggers-shared'
import type { RuntimeDefaults } from '@/lib/claude-code-preview/runtime-defaults'
import type { Collection, ObjectId } from 'mongodb'

export type BackgroundWorkLoss = 'session_lost' | 'unreachable'

export type ConversationPreviewAttachment = {
  /** Legacy: set by moves before they stopped minting a session id. Only
   *  getConversationPreviewAttachment reads it, and it answers "no session". */
  forceNew?: boolean
  runtimeDefaults?: RuntimeDefaults
  openabSessionId: string
  runtimeUrl: string
}

/**
 * The attachment as the runtime sees it. A legacy `forceNew` marker names a
 * session id the runtime never issued — moves used to mint one — so it means
 * "no session here". Every reader that would hand the id to a runtime must go
 * through this, or it gets a 500 on a conversation that is merely unstarted.
 *
 * No migration clears the marker: normalizing here is what makes it harmless,
 * and the next prompt overwrites the whole attachment anyway.
 */
export function liveAttachment(
  conversation: Pick<AgentConversation, 'claudeCodePreview'> | null | undefined,
): ConversationPreviewAttachment | null {
  const attachment = conversation?.claudeCodePreview

  return !attachment || attachment.forceNew ? null : attachment
}

// Per-turn desktop context the Claude Code runtime's MCP calls cannot carry
// themselves (they only know the conversation id).
export type ConversationPreviewContext = {
  diagramId?: string
  kubeContext?: string
  /** Exact active chat turn; MCP requests use it to durably join tool memory
   * activity back to the turn accumulator across backend replicas. */
  activeTurnKey?: string
  /** Origin of that active turn; conversation-principal writes that must come
   * from a live user (e.g. Instructions) require `user`. */
  activeTurnOrigin?: AgentSessionOrigin
  /** Whether that turn's client declared it can run local (Desktop) tools. */
  localTools?: boolean
}

export type AgentConversation = {
  _id?: ObjectId
  sessionId: string // Frontend-generated UUID
  userId: string // Nuphos user id
  teamId?: string
  titleManuallySet?: boolean
  title: string
  firstMessage: string
  messageCount: number
  transcriptUpdatedAt?: Date
  createdAt: Date
  lastActiveAt: Date
  // Owner-set archive marker. Archived conversations stay fully intact and
  // readable; list endpoints only hide them when asked (archived=exclude).
  archivedAt?: Date
  // When the owner last un-archived it by hand. The idle sweep counts from
  // here as well as from lastActiveAt, so a restored conversation is not
  // filed away again an hour later.
  archiveRestoredAt?: Date
  // Teammates who joined this conversation beside its owner. Speaking in a
  // session and being invited from Share are the same fact — "this person is
  // part of this conversation" — so both append here instead of splitting into
  // an invited/active pair of lists. Access itself is not stored: every member
  // of the conversation's team can already read and send (see
  // readableConversationScope / assertConversationSendable), so this list is
  // about who is involved, never about who is allowed.
  participantIds?: string[]
  /** Incremented at every assistant turn boundary. Absent means zero. */
  activitySeq?: number
  /** The owner's read marker, in `activitySeq` units. Only ever moves forward. */
  readSeq?: number
  compactionSummary?: string
  compactionMessageCount?: number
  // Exported Braintrust parent reference for this conversation. Created lazily
  // on the first turn that has Braintrust enabled, so every subsequent turn
  // nests under one "conversation" trace in the Braintrust UI.
  braintrustParent?: string
  credentialAccess?: AgentCredentialAccess
  // Execution runtime is chosen once when the conversation is created and is
  // changed only by an explicit move. Team settings are defaults for NEW conversations;
  // they must never migrate an existing conversation between agent engines.
  agentRuntime?: 'claude-code' | 'codex'
  runtimeId?: string
  runtimeLabel?: string
  /** Retains workspace ownership after a move, so deleting the old runtime can still save its files. */
  previousRuntimeUrls?: string[]
  runtimeOperation?: { token: string; expiresAt: Date }
  runtimeMigration?: {
    mode: 'history' | 'workspace'
    fromRuntimeId?: string
    toRuntimeId: string
    movedAt: Date
    movedBy: string
  }
  // Claude Code preview attachment: which OpenAB session carries this
  // conversation, on which runtime endpoint. Durable so any backend replica
  // reattaches to the same inner session instead of forking a new one.
  claudeCodePreview?: ConversationPreviewAttachment
  claudeCodePreviewContext?: ConversationPreviewContext
  // What became of whatever the inner agent process left running — background
  // tasks, monitors, watchers. `session_lost` is a resume answering that the
  // inner session is gone; `unreachable` is reattachment giving up without
  // ever getting an answer, which is weaker and worded as such. Kept outside
  // `claudeCodePreview` so a re-attachment write cannot drop it, and durable
  // so the notice survives a backend replica roll. The next prompt consumes it.
  claudeCodePreviewWorkLost?: { at: Date; reason: BackgroundWorkLoss }
  metadata?: {
    locale?: string
    provider?: string
    // Originating channel of the conversation ('app', 'mcp', 'slack.*',
    // 'slack.agent', 'agent.trigger'). Set on creation only.
    source?: string
    client?: AgentClientMeta
  }
  // Memory backend that owns this conversation's recall/tools/ingest, stamped
  // once at creation and immutable (SPI decision 4 / A3). Resolved through
  // resolveForNewSession (global default today; team overrides arrive in
  // Phase 3). Distinct from metadata.provider, which is the originating
  // CHANNEL, not the memory backend.
  memoryProvider?: string
  // Sticky per-conversation model fallback. Set write-once the first time a
  // turn finishes with finishReason 'content-filter'; every later turn in this
  // conversation then runs on toModelId instead of the primary. Permanent for
  // the life of the conversation.
  modelFallback?: {
    active: boolean
    reason: 'content-filter'
    firstTriggeredAt: Date
    fromModelId: string
    toModelId: string
  }
  tokenUsage?: AgentTokenUsageSummary
}

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
  // Optional for docs written before on-prem relay clusters existed.
  onpremClusterIds?: string[]
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
  posthogIntegrationIds?: string[]
  // Optional for docs written before these connectors moved off self-discovery
  // into the selected-credential tier.
  githubInstallationIds?: string[]
  gitlabBindingIds?: string[]
  grafanaInstanceIds?: string[]
  sonarqubeIntegrationIds?: string[]
  notionIntegrationIds?: string[]
  upstashAccountIds?: string[]
  cloudflareAccountIds?: string[]
  // Optional for docs written before devices joined the credential-selector
  // model — devices are user-owned, never team-shared.
  deviceIds?: string[]
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
  /** Runtime-originated assistant turn with no synthetic user message. */
  turnOrigin?: 'autonomous'
  /** A user turn a surface generated for a plan approval, not typed text. */
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

// Build a filter that scopes by teamId when provided. Pre-migration
// conversations don't have a `teamId` field at all, so we accept both
// `{ teamId }` and `{ teamId: { $exists: false } }` to keep them reachable
// until the next transcript sync backfills the field. Without this, every
// chat created before this PR would 404 / disappear from history.
export function withTeamScope(
  base: Record<string, unknown>,
  teamId: string | undefined,
): Record<string, unknown> {
  if (!teamId) return base

  return {
    ...base,
    $or: [{ teamId }, { teamId: { $exists: false } }],
  }
}

export function readableConversationScope(
  base: Record<string, unknown>,
  viewerUserId: string,
  teamId: string | undefined,
): Record<string, unknown> {
  if (!teamId) return { ...base, userId: viewerUserId }

  return { ...base, teamId }
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
