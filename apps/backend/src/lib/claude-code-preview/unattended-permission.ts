// What an automatic turn may run when nobody is there to approve it (#4147).
import { nuphosToolName, parseToolUpdate, prettifyToolTitle } from './preview-agent-update'

import type { OpenAbPermissionRequest } from './openab-acp-session'

/** The tools an unattended turn may use on a channel that woke it: read it, and answer there. */
const WAKING_CHANNEL_TOOLS = new Set(['channel_read', 'channel_post'])

/**
 * Whether an automatic turn may run this call without asking. Only reading the
 * channel that woke it and answering there: anything else could read what the
 * channel's members may not see and post it back.
 */
export function allowedUnattended(
  toolCall: OpenAbPermissionRequest['toolCall'],
  wokenChannelIds: readonly string[],
  // codex-acp asks about an MCP call by its id alone; the call's own update named it (#5133).
  known?: KnownTool,
): boolean {
  const update = parseToolUpdate(toolCall.toolCallId, { ...toolCall })

  if (update.kind !== 'tool') return false
  const tool = nuphosToolName(update.mcpToolId) ?? known?.mcpToolName ?? null
  const input = update.rawInput ?? known?.input
  const channelId = (input as { channelId?: unknown } | undefined)?.channelId

  return (
    tool !== null &&
    WAKING_CHANNEL_TOOLS.has(tool) &&
    typeof channelId === 'string' &&
    wokenChannelIds.includes(channelId)
  )
}

export function unattendedDeniedText(title: string): string {
  return (
    `Not run: ${prettifyToolTitle(title)} needs approval, and nobody was here to give it in this ` +
    'automatic turn. To let it run on its own, switch this Bot to Full Access, or approve it ' +
    "when you're in the conversation."
  )
}

/** A call as its own tool update described it: the Nuphos tool it runs, and its input. */
export type KnownTool = { mcpToolName?: string; input?: unknown }

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
    /** A refused or unanswered request: a headless turn goes on to say so, a watched one ends. */
    refusal: run?.deadlineAt === undefined ? ('cancel' as const) : ('reject' as const),
  }
}
