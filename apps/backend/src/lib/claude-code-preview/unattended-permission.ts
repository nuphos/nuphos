// What an automatic turn may run when nobody is there to approve it (#4147).
import { nuphosToolName, parseToolUpdate, prettifyToolTitle } from './preview-agent-update'

import type { OpenAbPermissionRequest } from './openab-acp-session'

/**
 * Nuphos's own tools that only read what the agent can already see. An automatic
 * turn runs them without asking, since nobody is there to answer.
 */
const UNATTENDED_READ_ONLY_TOOLS = new Set([
  'channel_read',
  'memory_get',
  'read_conversation',
  'list_recent_conversations',
  'list_tasks',
  'list_session_resources',
  'list_user_decisions',
  'list_agent_runtimes',
  'list_boxes',
  'slack_list_destinations',
  'lark_list_destinations',
  'port_forward_list',
])

/**
 * Whether an automatic turn may run this call without asking: one of Nuphos's
 * read-only tools, or a reply to a channel that woke the turn, since answering
 * where it was called is the point of a channel turn.
 */
export function allowedUnattended(
  toolCall: OpenAbPermissionRequest['toolCall'],
  wokenChannelIds: readonly string[],
): boolean {
  const update = parseToolUpdate(toolCall.toolCallId, { ...toolCall })

  if (update.kind !== 'tool') return false
  const tool = nuphosToolName(update.mcpToolId)

  if (tool === 'channel_post') {
    const channelId = (update.rawInput as { channelId?: unknown } | undefined)?.channelId

    return typeof channelId === 'string' && wokenChannelIds.includes(channelId)
  }

  return tool !== null && UNATTENDED_READ_ONLY_TOOLS.has(tool)
}

export function unattendedDeniedText(title: string): string {
  return (
    `Not run: ${prettifyToolTitle(title)} needs approval, and nobody was here to give it in this ` +
    'automatic turn. To let it run on its own, switch this Bot to Full Access, or approve it ' +
    "when you're in the conversation."
  )
}

/** The run a turn's permission requests come from, as far as unattended rules go. */
export type UnattendedRun = {
  deadlineAt?: number
  channelIds?: string[]
  trace?: { route: string }
}

/**
 * Only headless turns carry a deadline, since nobody in the app can answer them. One
 * an event started fails at once; a sub-Task's still asks, for a person to answer from
 * the sidebar.
 */
export function unattendedTurn(run: UnattendedRun | undefined) {
  return {
    headless: run?.deadlineAt !== undefined,
    wokenChannelIds: run?.channelIds ?? [],
    failFast: run?.trace?.route === 'agent.resource',
  }
}
