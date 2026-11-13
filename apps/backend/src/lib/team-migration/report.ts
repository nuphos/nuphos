import { ObjectId } from 'mongodb'

import { agentConversations } from '@/lib/agent/db/shared'
import { teamByosBindings } from '@/models'

import type { ClientSession } from 'mongodb'

export type Exclusion = {
  category: string
  sourceId?: string
  label?: string
  reason: string
  nextAction: string
}

export function baseExclusions(): Exclusion[] {
  return [
    {
      category: 'credentials',
      reason: 'Cloud, OAuth, database and personal credentials are not portable',
      nextAction:
        'Reconnect integrations on the destination; credentials and sealed secrets are not included',
    },
    {
      category: 'runtimes',
      reason: 'Devices, managed Boxes, provider sessions and running work are not migrated',
      nextAction: 'Connect a destination runtime and explicitly start new work',
    },
    {
      category: 'files',
      reason:
        'File binaries, workspace archives, tool payloads and trace/journal records are excluded',
      nextAction: 'Copy needed files separately; old file links will be unavailable',
    },
    {
      category: 'automation',
      reason:
        'Execution approvals, webhook subscriptions, refresh jobs and delivery queues are excluded',
      nextAction: 'Reconnect and explicitly review and enable automation',
    },
    {
      category: 'source-links',
      reason: 'Text, scripts and external URLs retain their original source references',
      nextAction:
        'Review source links and scripts before use; imported content may contain pasted secrets',
    },
    {
      category: 'personal-knowledge',
      reason: 'Personal instructions, memories and skills are excluded',
      nextAction: 'Move personal knowledge separately if required',
    },
    {
      category: 'schedules',
      reason:
        'Runtime-owned one-shot wakeups are execution state, not portable backend schedule records',
      nextAction: 'Create new wakeups explicitly; no old wakeup is replayed',
    },
  ]
}

export async function writeReconnectReport(
  teamId: string,
  session: ClientSession,
  exclusions: Exclusion[],
) {
  const bindings = await teamByosBindings().findOne({ _id: new ObjectId(teamId) }, { session })

  // Bindings are never copied: only their type and internal id reach the checklist.
  if (bindings)
    for (const [provider, entries] of Object.entries(bindings)) {
      if (!Array.isArray(entries)) continue
      for (const entry of entries as {
        _id?: ObjectId
        id?: string | ObjectId
        label?: string
        name?: string
      }[]) {
        exclusions.push({
          category: `connector:${provider}`,
          sourceId: String(entry._id ?? entry.id ?? provider),
          label: typeof entry.label === 'string' ? entry.label : undefined,
          reason: 'Connector credentials and trust are deployment-specific',
          nextAction: 'Reconnect this integration on the destination',
        })
      }
    }
  for await (const row of agentConversations().find(
    { teamId, runtimeId: { $exists: true } },
    { session, projection: { sessionId: 1 } },
  )) {
    exclusions.push({
      category: 'conversation-runtime',
      sourceId: row.sessionId,
      reason: 'Runtime, credential selection and linked resource subscriptions are excluded',
      nextAction: 'Select a destination runtime and reconnect required resources',
    })
  }
}
