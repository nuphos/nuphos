// Shared contract between the Claude Code preview's MCP tool surfaces and the
// chat seam. Tool handlers run on the backend (any replica) while the turn's
// run lives on the replica serving the SSE stream; frames reach it through
// the run-frame bridge.
import type { AgentSessionOrigin } from '@/lib/agent/tools-triggers-shared'
import type { ToolHandler } from '@/lib/mcp/protocol'

export type PreviewToolContext = {
  userId: string
  /** Durable run owner; permission checks still use userId (the actor). */
  conversationOwnerUserId?: string
  teamId: string
  /** The conversation id (== agent session id). */
  sessionId: string
  /** Active chat request id, read from the durable conversation context. */
  turnKey?: string
  /** Who started the active turn: a live user, or a trigger/automation/alert. */
  turnOrigin?: AgentSessionOrigin
  locale: string
  /** Whether the client driving this turn can run tools on the user's machine. */
  localTools?: boolean
  /** Architecture diagram the desktop tab has open, when any. */
  diagramId?: string
  /** Slack thread the conversation is bound to, when any. */
  slackThread?: { teamId: string; channelId: string; threadTs: string }
}

/** One MCP tool: its advertised definition plus a context-bound handler. */
export type PreviewToolModule = {
  definitions: readonly unknown[]
  handlers: (ctx: PreviewToolContext) => Record<string, ToolHandler>
}

/**
 * Publish an SSE frame (same vocabulary the desktop renders for the classic
 * agent: tool-input-available, tool-output-available, data-* cards, …) into
 * the conversation's active run, wherever that run is hosted.
 */
export type PublishPreviewFrame = (
  ctx: Pick<PreviewToolContext, 'userId' | 'sessionId' | 'conversationOwnerUserId'>,
  frame: Record<string, unknown>,
) => Promise<void>
