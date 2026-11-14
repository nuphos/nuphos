/**
 * How a trigger came to fire. Recorded per run because the same trigger fires
 * on its schedule, from a provider webhook, and from the Trigger page's own
 * Run-now button, and a run list that cannot tell those apart reads as if the
 * schedule ran twice.
 */
export type ConversationTriggerRunKind = 'scheduled' | 'webhook' | 'manual'

const RUN_KINDS = new Set<string>(['scheduled', 'webhook', 'manual'])

/** A conversation's link back to the trigger that fired it. */
export type ConversationTriggerRun = {
  id: string
  kind?: ConversationTriggerRunKind
  /**
   * The single fire this turn belongs to (the queue job id), when the caller
   * has one. A bound conversation accumulates turns from many fires, so the
   * Trigger id alone cannot attribute usage to one of them.
   */
  fireId?: string
}

/**
 * Assemble the stamp an execution writes onto its conversation.
 *
 * `runKind` is a parameter rather than something derived here on purpose: only
 * the caller knows whether a fire came from the scheduler, a provider webhook,
 * or the Trigger page's Run-now button, and guessing would mislabel runs in the
 * one list built to tell them apart.
 */
export function buildTriggerRunStamp(args: {
  triggerId: string
  runKind: ConversationTriggerRunKind
  fireId?: string
}): ConversationTriggerRun {
  return {
    id: args.triggerId,
    kind: args.runKind,
    ...(args.fireId ? { fireId: args.fireId } : {}),
  }
}

/**
 * Read the stamp back off a conversation's metadata.
 *
 * The id is what makes a conversation a run — it is the only thing linking it
 * to a Trigger, and Chats excludes exactly the conversations that have one. A
 * stamp missing its id therefore normalizes to null rather than to a run that
 * no Trigger page can ever list.
 */
export function normalizeConversationTriggerRun(
  metadata: Record<string, unknown> | undefined | null,
): ConversationTriggerRun | null {
  const stamp = metadata?.trigger

  if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)) return null
  const { id, kind, fireId } = stamp as Record<string, unknown>

  if (typeof id !== 'string' || !id) return null

  return {
    id,
    ...(typeof kind === 'string' && RUN_KINDS.has(kind)
      ? { kind: kind as ConversationTriggerRunKind }
      : {}),
    ...(typeof fireId === 'string' && fireId ? { fireId } : {}),
  }
}
