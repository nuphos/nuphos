import type { AgentConversationTriggerRun, AgentTriggerRunKind } from '../api'

const KIND_LABELS: Record<AgentTriggerRunKind, { label: string; description: string }> = {
  scheduled: { label: 'Scheduled', description: 'Fired by this trigger schedule' },
  webhook: { label: 'Webhook', description: 'Fired by an external webhook' },
  manual: { label: 'Manual', description: 'Fired by hand from Nuphos' },
}

export type TriggerRunLabel = {
  label?: string
  description?: string
  /** Watch group runs: the monitored item this run was about. */
  memberKey?: string
}

/**
 * What to show beside a run in a Trigger's run list.
 *
 * Runs of one trigger share their owner, and usually their title too, so how
 * the run started is the thing that tells them apart. Returns null when there
 * is nothing to say — a conversation that is not a run, or a run stamped
 * before the kind was recorded, where naming a kind would be a guess.
 */
export function triggerRunLabel(
  run: AgentConversationTriggerRun | undefined,
): TriggerRunLabel | null {
  if (!run) return null
  const kind = run.kind ? KIND_LABELS[run.kind] : undefined

  if (!kind && !run.memberKey) return null

  return {
    ...kind,
    ...(run.memberKey ? { memberKey: run.memberKey } : {}),
  }
}
