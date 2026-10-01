export function shouldResumeRuntimeWakeup(
  activeRun: { streamId: string } | null | undefined,
  stoppedStreamId: string | null | undefined,
): boolean {
  return Boolean(activeRun && activeRun.streamId !== stoppedStreamId)
}

/** Transport retry exhaustion is terminal for this run, just like Stop. A
 * later runtime turn has a new stream id and can still wake the conversation. */
export function rememberTerminalRuntimeStream(
  stoppedRuns: Map<string, string>,
  sessionId: string,
  streamId: string,
  event: Record<string, unknown>,
): void {
  const sse = event.type === 'sse' ? event.data : undefined

  if (
    event.type === 'error' ||
    event.type === 'aborted' ||
    event.type === 'agent-setup-required' ||
    (sse && typeof sse === 'object' && (sse as Record<string, unknown>).type === 'error')
  ) {
    stoppedRuns.set(sessionId, streamId)
  }
}

/**
 * How many transcript messages a wakeup probe must download: 0 while the
 * stored count matches what the client holds, otherwise the new messages plus
 * the one the client already had last, in case the runtime turn finished
 * writing it. The probe itself asks for one message, since `activeRun` and
 * `messageCount` are top-level fields, and a full tail on every tick cost
 * 1–2 MB × 900/h per idle chat.
 */
export function wakeupTranscriptTail(
  serverMessageCount: number,
  localBaseIndex: number | undefined,
  localMessageCount: number,
  limit: number,
  contentChanged = false,
): number {
  const delta = serverMessageCount - ((localBaseIndex ?? 0) + localMessageCount)

  // A background tool can finish without adding a message. Re-read the
  // loaded history only when its revision changes; never roll back unsaved
  // local messages to an older server snapshot.
  if (contentChanged && delta >= 0) return Math.min(1000, Math.max(1, localMessageCount + delta))
  if (delta <= 0) return 0

  return Math.min(limit, delta + 1)
}

/**
 * Whether a fetched tail starts past the messages the client holds. Messages
 * that land while the delta request is in flight push the server's tail up,
 * and splicing such a tail onto the local prefix would leave a hole.
 */
export function wakeupTailLeavesHole(
  serverFirstIndex: number,
  localBaseIndex: number | undefined,
  localMessageCount: number,
): boolean {
  return serverFirstIndex > (localBaseIndex ?? 0) + localMessageCount
}
