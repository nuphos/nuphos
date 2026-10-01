// The client-tool phase: the backend stream has ended, the turn is parked on a
// tool call only this machine can run, and no stream owns it. Deciding WHICH
// calls are ours to run, and when the phase has gone silent for too long, lives
// here so both are testable without the panel.

// local_exec is not in this set: the backend dispatches it directly to a
// registered device over the presence stream, not through this client-tool
// approval/execute path.
export const CLIENT_SIDE_LOCAL_TOOLS = new Set([
  'port_forward_start',
  'port_forward_stop',
  'port_forward_list',
  'upload_attachment',
])

// A client tool that produced nothing for this long, with nothing else moving,
// is not slow — it is lost. The per-tool deadline (clientToolDeadline.ts) covers
// an invoke that hangs; this covers the phase itself never getting off the
// ground, which no timer downstream of the invoke can see.
export const CLIENT_TOOL_PHASE_STALL_MS = 90_000

// Parts arrive from a transcript, so the array holds text and reasoning parts
// too — `toolName`/`state` are optional here and narrowed below. Requiring them
// up front made the one real caller (`Message[]`) unassignable.
type PendingToolPart = {
  type: string
  toolName?: string
  state?: string
  approval?: { approved?: boolean }
}

type MessageWithParts<P> = { role: string; parts: P[] }

export function pendingClientSideLocalTools<P extends PendingToolPart>(
  messages: MessageWithParts<P>[],
): P[] {
  const last = messages[messages.length - 1]

  if (last?.role !== 'assistant') return []

  return last.parts.filter(
    (part) =>
      part.type === 'tool' &&
      part.state === 'input-available' &&
      part.toolName !== undefined &&
      CLIENT_SIDE_LOCAL_TOOLS.has(part.toolName) &&
      // A call still waiting on the user's approve/deny is the dialog's to run,
      // not ours: executing it here would run an unapproved command.
      (!part.approval || part.approval.approved === true),
  )
}

export function clientToolPhaseStalled(
  tab: { streaming: boolean; streamId: string | null; streamStartedAt: number | null },
  now: number,
): boolean {
  if (!tab.streaming || tab.streamId !== null || !tab.streamStartedAt) return false

  return now - tab.streamStartedAt >= CLIENT_TOOL_PHASE_STALL_MS
}

export function clientToolPhaseStallText(tools: { toolName: string }[]): string {
  const names = [...new Set(tools.map((t) => t.toolName))].join(', ') || 'the local tool'

  return `${names} never reported back on this machine (no result after ${String(
    Math.round(CLIENT_TOOL_PHASE_STALL_MS / 1000),
  )}s).`
}

/** Whether a committed client-tool phase still needs an execution owner. */
export function clientToolPhaseNeedsDispatch(
  tab: {
    streaming: boolean
    streamId: string | null
    messages: MessageWithParts<PendingToolPart>[]
  },
  claimed: boolean,
): boolean {
  return (
    !claimed &&
    tab.streaming &&
    tab.streamId === null &&
    pendingClientSideLocalTools(tab.messages).length > 0
  )
}

/**
 * A run belongs to the client that STARTED it. A follower must neither execute
 * the turn's local tools (the same command would run on two machines) nor
 * auto-resume it (a new stream id there starts a competing turn on the same
 * session). The owner does both, and the follower picks up whatever it starts
 * next through the catch-up poll.
 *
 * `attachedStreamId` is set by that poll alone — a run that appeared while
 * this client sat idle on the conversation was started somewhere else, full
 * stop. Resuming an active run when a conversation is OPENED is deliberately
 * not marked: after the app restarts, the reopening client may be the only one
 * left, and refusing to run the tool there would strand the turn.
 *
 * The comparison is against the ending stream rather than a flag that has to
 * be cleared: a stale marker cannot match a stream this client started itself.
 */
export function runBelongsToThisClient(
  tab: { attachedStreamId?: string | null },
  streamId: string,
): boolean {
  return tab.attachedStreamId !== streamId
}
