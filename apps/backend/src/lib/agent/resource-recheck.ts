import { logEvent } from '@/lib/observability'

import { agentConversations } from './db'
import { resourceCredentialAllowed } from './session-resource-lookup'
import { refreshSessionResource } from './session-resources'

import type { AgentConversation } from './db'
import type { SessionResource } from './session-resources'

/** How long a linked resource's stored state is trusted before a read checks it again. */
export const RECHECK_INTERVAL_MS = 5 * 60_000
/** Rechecks running at once in this process; the rest wait for a later read. */
export const MAX_RUNNING_RECHECKS = 4
const running = new Set<string>()

/** A merged or closed PR, or a completed or canceled issue, no longer changes on its own. */
export function resourceFinished(resource: SessionResource) {
  if (resource.provider === 'github') return resource.state !== 'open'

  return resource.stateType === 'completed' || resource.stateType === 'canceled'
}

function recheckDue(resource: SessionResource, now: number) {
  if (resourceFinished(resource)) return false
  if (resource.provider === 'github' && (!resource.repository || !resource.number)) return false

  return !resource.checkedAt || now - Date.parse(resource.checkedAt) >= RECHECK_INTERVAL_MS
}

async function recheck(conversation: AgentConversation, resource: SessionResource, now: number) {
  // Claim the check first, so other readers and replicas skip it until the interval passes,
  // including when the lookup below fails.
  const claim = await agentConversations().updateOne(
    {
      sessionId: conversation.sessionId,
      linkedResources: {
        $elemMatch: {
          id: resource.id,
          $or: [
            { checkedAt: { $exists: false } },
            { checkedAt: { $lte: new Date(now - RECHECK_INTERVAL_MS).toISOString() } },
          ],
        },
      },
    },
    { $set: { 'linkedResources.$.checkedAt': new Date(now).toISOString() } },
  )

  if (!claim.modifiedCount) return
  // The integration was deselected or disconnected; the next link or webhook catches up.
  if (!(await resourceCredentialAllowed(conversation, resource))) return
  await refreshSessionResource(conversation, resource)
}

/**
 * Re-reads linked resources that may have changed without a webhook telling us,
 * such as a PR merged in a repository whose events do not reach this App
 * installation. Each resource is checked at most once per interval; failures
 * are logged and never reach the caller, which does not need to wait.
 */
export async function recheckLinkedResources(conversation: AgentConversation, now = Date.now()) {
  // An archived conversation shows no chips until a turn restores it.
  if (conversation.archivedAt) return
  const checks: Promise<void>[] = []

  for (const resource of conversation.linkedResources ?? []) {
    if (running.size >= MAX_RUNNING_RECHECKS) break
    const key = `${conversation.sessionId}/${resource.id}`

    if (running.has(key) || !recheckDue(resource, now)) continue
    running.add(key)
    checks.push(
      recheck(conversation, resource, now)
        .catch((error: unknown) => {
          logEvent('warn', 'linked_resource.recheck_failed', {
            provider: resource.provider,
            error: String(error),
          })
        })
        .finally(() => running.delete(key)),
    )
  }
  await Promise.all(checks)
}
