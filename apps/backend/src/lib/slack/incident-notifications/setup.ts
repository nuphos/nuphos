import { logEvent } from '@/lib/observability'
import { slackNotificationIncidents } from '@/lib/slack/incident-notifications/model'
import {
  seedIncidentOccurrence,
  setupSlackIncidentOccurrenceIndexes,
} from '@/lib/slack/incident-occurrences'

export async function setupSlackNotificationIncidentIndexes(): Promise<void> {
  const collection = slackNotificationIncidents()

  await collection.updateMany(
    { incidentScope: { $exists: false } },
    { $set: { incidentScope: 'default' } },
  )
  const indexes = await collection.indexes().catch(() => [])
  const legacyUnique = indexes.find(
    (index) =>
      index.name === 'slack_notification_incident_unique' &&
      !Object.hasOwn(index.key ?? {}, 'incidentScope'),
  )

  if (legacyUnique) {
    await collection.dropIndex('slack_notification_incident_unique').catch((error: unknown) => {
      const mongoError = error as { code?: number; codeName?: string }

      // Multiple backend replicas can run setup concurrently. Once one has
      // removed the legacy index, IndexNotFound is the desired state for the
      // others; every other failure must still stop startup.
      if (mongoError.code !== 27 && mongoError.codeName !== 'IndexNotFound') throw error
    })
  }
  await collection.createIndex(
    {
      teamId: 1,
      slackWorkspaceId: 1,
      slackChannelId: 1,
      triggerId: 1,
      incidentScope: 1,
    },
    { unique: true, background: true, name: 'slack_notification_incident_unique' },
  )

  // Incidents that were already live when this release landed carry their
  // thread under the previous release's field names. Without this, the next
  // firing of an alert that is mid-incident finds no history and starts a new
  // thread — the exact spam this feature exists to prevent, on the incidents
  // people are actually watching. The old fields are deliberately left in
  // place so a rollback still works.
  await collection.updateMany(
    { latestThreadTs: { $exists: false }, rootThreadTs: { $exists: true } },
    [
      {
        $set: {
          latestThreadTs: '$rootThreadTs',
          latestSessionId: '$rootSessionId',
          postWindowStartedAt: '$updateWindowStartedAt',
          postCountInWindow: { $ifNull: ['$updateCountInWindow', 0] },
          totalPostCount: { $ifNull: ['$totalUpdateCount', 0] },
        },
      },
    ],
  )

  // The ledger is new, so it knows nothing about incidents that are open right
  // now. Seed one row each so incident_history can actually offer their thread
  // to the next firing.
  // Seeding upserts on the occurrence key, so its unique index has to exist
  // first. Awaiting it here makes that ordering real instead of relying on how
  // the setup steps happen to be scheduled.
  await setupSlackIncidentOccurrenceIndexes()
  const live = await collection
    .find(
      { state: 'open', rootThreadTs: { $exists: true }, rootSessionId: { $exists: true } },
      {
        projection: {
          teamId: 1,
          triggerId: 1,
          incidentScope: 1,
          rootThreadTs: 1,
          rootSessionId: 1,
          lastNotificationAt: 1,
          createdAt: 1,
        },
      },
    )
    .toArray()

  for (const incident of live) {
    await seedIncidentOccurrence({
      teamId: incident.teamId,
      triggerId: incident.triggerId,
      incidentScope: incident.incidentScope ?? 'default',
      sessionId: incident.rootSessionId!,
      slackThreadTs: incident.rootThreadTs!,
      firedAt: incident.lastNotificationAt ?? incident.createdAt,
      note: 'Carried over from before this alert kept its own history.',
    }).catch((err: unknown) => {
      logEvent('warn', 'slack.incident_occurrence.seed_failed', {
        trigger_id: incident.triggerId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }
}
