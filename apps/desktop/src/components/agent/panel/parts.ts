import { createContext } from 'react'

import type { AgentMemoryIngestEventItem } from '../../../api'
import type { AgentMessageMetadata } from '../../../api/agent-types'

export type TextPart = { type: 'text'; text: string }
// Extended thinking: streamed when the backend enables it; folded
// in the UI, persisted with the transcript, hashed into the journal.
export type ReasoningPart = {
  type: 'reasoning'
  text: string
  startedAt?: number
  completedAt?: number
}
export type LocalFilePart = { type: 'local-file'; path: string }
// An image the user attached in the composer. Sent to the model as a
// vision `file` part (it reads the pixels directly) — NOT uploaded to the
// sandbox. `path` is retained so a later on-demand upload can reuse the local
// file without re-attaching.
export type ImageAttachmentPart = {
  type: 'image'
  mediaType: string
  url: string // data: URL (downscaled in the main process when oversized)
  fileName: string
  path?: string
  // Opaque handle the agent can pass to the upload_attachment tool to transfer
  // the actual file into the sandbox on demand.
  attachmentId?: string
}
// Files the user uploaded to the Nuphos transfer store. The bytes
// live in S3; the agent pulls them into its sandbox via the file-transfer
// skill. Rendered as a card; serialized to a pull instruction for the agent.
export type TransferUploadPart = {
  type: 'transfer-upload'
  groupId: string
  // Overall lifecycle so the card can show a loading state while bytes stream to
  // S3 (the user's message renders immediately; the upload resolves after). Older
  // persisted parts have no `status` — treat those as already-uploaded.
  status?: 'uploading' | 'ready' | 'error'
  // True when a folder / multi-file selection was packed into one .zip object;
  // the agent is told to pull-and-extract it. Single-file uploads omit this.
  archive?: boolean
  archiveEntryCount?: number
  files: { fileName: string; size: number | null; status: string }[]
}
export type ToolAuthorization = {
  decision: 'allow' | 'require_auth'
  layer: string
  reason?: string
  triggeredBy?:
    | { kind: 'read_only' }
    | { kind: 'prior_grant' }
    | { kind: 'rule'; ruleId?: string; description: string }
    | { kind: 'judge'; reason: string }
  // For require_auth: the judge's short generalized rule text, prefilled into
  // the "Always allow" description input. Absent when nothing is generalizable.
  suggestedRule?: string
  // Set once the user acts on a require_auth prompt, to hide the buttons.
  resolved?: 'approved' | 'denied'
}
export type AuthorizationDecisionAction = 'once' | 'session' | 'always' | 'deny'
export type AuthorizationActionContextValue = {
  // ruleDescription is the generalized rule text for the 'always' decision.
  decide: (
    toolCallId: string,
    decision: AuthorizationDecisionAction,
    ruleDescription?: string,
  ) => void
  // Only the LAST unresolved require_auth in the conversation shows buttons —
  // earlier blocked calls are stale (superseded by a newer attempt).
  activeToolCallId: string | null
  // Read-only sessions (audit views / foreign / Slack conversations) must never
  // expose approve/deny or rule-confirm actions — an audit surface is view-only.
  readOnly: boolean
}
export const AuthorizationActionContext = createContext<AuthorizationActionContextValue | null>(
  null,
)

export type ToolPart = {
  type: 'tool'
  toolCallId: string
  toolName: string
  state:
    | 'input-streaming'
    | 'input-available'
    // Native AI SDK HITL: the tool call is paused awaiting the user's decision,
    // then carries the decision back on resubmit (the SDK executes the tool).
    | 'approval-requested'
    | 'approval-responded'
    | 'output-available'
    | 'output-error'
  startedAt?: number
  completedAt?: number
  input?: unknown
  output?: unknown
  /** Transient stdout/stderr received while a command is still running. The
   * completed tool output replaces it and is the only value persisted into
   * model history. */
  liveOutput?: { stdout: string; stderr: string }
  errorText?: string
  // AI SDK tool-approval envelope (HMAC-signed): id binds the response to the
  // request; approved is set once the user decides.
  approval?: {
    id: string
    signature?: string
    approved?: boolean
    reason?: string
    /** OpenAB permission relays are one-shot provider decisions, not Nuphos rules. */
    source?: 'openab'
  }
  // Auto Mode: which policy authorized (or required auth for) this call.
  authorization?: ToolAuthorization
}
export function describeAutoAuthorization(
  t: NonNullable<ToolAuthorization['triggeredBy']>,
): string {
  if (t.kind === 'read_only') return 'Auto-authorized: read-only command'
  if (t.kind === 'prior_grant') return 'Auto-authorized: you approved this earlier'
  if (t.kind === 'judge') return `Auto-authorized (judged a safe read): ${t.reason}`

  return `Auto-authorized by your rule: "${t.description}"`
}
export type MemoryIngestPart = {
  type: 'memory-ingest'
  id: string
  sessionId: string
  kind: 'ok' | 'skipped' | 'error'
  text: string
  createdAt: string
  memories?: AgentMemoryIngestEventItem[]
  detailsLoadedAt?: string
}
// ADR-0007 #2: which memories this answer drew on. Recalled = shown in the
// injected index; fetched = the agent actually loaded via memory_get.
export type MemoryProvenancePart = {
  type: 'memory-provenance'
  id: string
  sessionId: string
  personalIds: string[]
  teamIds: string[]
  // Ids the agent loaded via memory_get this turn — kept as IDS so the view
  // can compute the true union with the recalled set (fetched entries may or
  // may not overlap it). fetchedCount survives for persisted old transcripts.
  fetchedIds: string[]
  fetchedCount: number
  // Scoped split of fetchedIds — inspect/remove need the right pool (genes
  // resolve as team). Absent on frames persisted before the split existed.
  fetchedPersonalIds?: string[]
  fetchedTeamIds?: string[]
  // Delivery mode the backend used this turn ('injection' | 'summary' |
  // 'automatic'). Absent on frames persisted before it was added.
  deliveryMode?: string
  // The turn's requestId — key for lazily fetching this turn's attribution
  // tiers (the judge lands after the stream closes). Absent on old frames.
  turnKey?: string
  // One-line label per memory id, sent with the frame so the ribbon can name
  // what was remembered immediately. Absent on frames persisted before this
  // existed — the view still falls back to fetching each memory.
  labels?: Record<string, string>
  teamId?: string
  createdAt: string
}
// Marks a step boundary inside the assistant message. convertToModelMessages uses these to
// split the message into Anthropic-compliant blocks (assistant text + tool-uses, tool-results,
// then assistant text again). Without it, multi-step responses produce text-after-tool_use,
// which Bedrock rejects.
export type StepStartPart = { type: 'step-start' }
// The backend ended this turn early; persisted so a reloaded conversation still shows why.
export type TurnInterruptedPart = {
  type: 'turn-interrupted'
  id: string
  reason: 'cancelled' | 'timeout' | 'error'
  message: string
  createdAt: string
}
export type SteeringPart = {
  type: 'data-steering'
  data: { id: string; text: string; metadata?: AgentMessageMetadata }
}
export type Part =
  | SteeringPart
  | TextPart
  | ReasoningPart
  | LocalFilePart
  | ImageAttachmentPart
  | TransferUploadPart
  | ToolPart
  | MemoryIngestPart
  | MemoryProvenancePart
  | TurnInterruptedPart
  | StepStartPart

export function isHiddenMemoryIngestPart(part: MemoryIngestPart): boolean {
  return part.text.toLowerCase().includes('queued')
}
