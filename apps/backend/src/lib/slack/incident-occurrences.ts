import { db } from '@/lib/db'

import type { Collection, ObjectId } from 'mongodb'

const COLLECTION = 'slack_incident_occurrences'

/**
 * One time this alert fired, and what was done about it.
 *
 * Keyed on the run, not on a server-side incident lifecycle: an alert firing is
 * a fact, whereas "the incident is open" was only ever the server guessing at
 * something it now asks the model directly. What a later on-call needs is the
 * plain record — it went off at this time, someone wrote this, in that thread.
 */
export type SlackIncidentOccurrence = {
  _id?: ObjectId
  teamId: string
  triggerId: string
  incidentScope: string
  /** The agent run that handled this firing. */
  sessionId: string
  firedAt: Date
  /** The provider's own words for the alert state, unclassified. */
  reportedStatus?: string
  /** Where the agent wrote, once it decided. */
  slackThreadTs?: string
  startedNewThread?: boolean
  /** The last thing the agent said about it — the "what came of it" line. */
  lastMessage?: string
  lastMessageAt?: Date
  messageCount: number
  updatedAt: Date
}

const MESSAGE_MAX_CHARS = 500

export const slackIncidentOccurrences = (): Collection<SlackIncidentOccurrence> =>
  db().collection<SlackIncidentOccurrence>(COLLECTION)

export async function setupSlackIncidentOccurrenceIndexes(): Promise<void> {
  const collection = slackIncidentOccurrences()

  // Delivery completion is replayed by lease recovery, so writes are upserts
  // on the run rather than inserts.
  await collection.createIndex(
    { teamId: 1, triggerId: 1, incidentScope: 1, sessionId: 1 },
    { unique: true, background: true, name: 'slack_incident_occurrence_unique' },
  )
  await collection.createIndex(
    { teamId: 1, triggerId: 1, incidentScope: 1, firedAt: -1 },
    { background: true, name: 'slack_incident_occurrence_history' },
  )
}

export function summarizeIncidentMessage(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()

  return collapsed.length > MESSAGE_MAX_CHARS
    ? `${collapsed.slice(0, MESSAGE_MAX_CHARS)}…`
    : collapsed
}

type OccurrenceKey = {
  teamId: string
  triggerId: string
  incidentScope: string
  sessionId: string
}

/** The alert went off. Recorded before the agent decides anything. */
export async function recordIncidentFiring(
  input: OccurrenceKey & { firedAt: Date; reportedStatus?: string },
): Promise<void> {
  const { firedAt, reportedStatus, ...key } = input

  await slackIncidentOccurrences().updateOne(
    key,
    {
      $set: { updatedAt: firedAt },
      $setOnInsert: {
        ...key,
        firedAt,
        ...(reportedStatus ? { reportedStatus } : {}),
        messageCount: 0,
      },
    },
    { upsert: true },
  )
}

/** The agent said something about it, in a thread it chose. */
export async function recordIncidentMessage(
  input: OccurrenceKey & {
    slackThreadTs: string
    startedNewThread: boolean
    /** Omitted by a lease-recovery replay, which has no copy of the prose. */
    text?: string
    at: Date
  },
): Promise<void> {
  const { slackThreadTs, startedNewThread, text, at, ...key } = input

  await slackIncidentOccurrences().updateOne(
    key,
    {
      $set: {
        slackThreadTs,
        // Only ever overwrite the summary with real prose.
        ...(text ? { lastMessage: summarizeIncidentMessage(text), lastMessageAt: at } : {}),
        updatedAt: at,
        // Whether this firing opened its own thread is decided by its first
        // message, and only a new thread can set it.
        ...(startedNewThread ? { startedNewThread: true } : {}),
      },
      $inc: { messageCount: 1 },
      $setOnInsert: { ...key, firedAt: at },
    },
    { upsert: true },
  )
}

/**
 * Bootstrap one history row for an incident that predates the ledger.
 *
 * Insert-only on purpose. This runs on every backend start, and a live incident
 * keeps its `state: 'open'` marker for rollout compatibility, so it will keep
 * matching long after real messages have been recorded. Anything that updated an
 * existing row would overwrite what the agent actually said with a placeholder
 * and inflate the count once per restart — and `lastMessage` is exactly what the
 * next firing reads to judge whether it is the same problem.
 */
export async function seedIncidentOccurrence(
  input: OccurrenceKey & { slackThreadTs: string; firedAt: Date; note: string },
): Promise<void> {
  const { slackThreadTs, firedAt, note, ...key } = input

  await slackIncidentOccurrences().updateOne(
    key,
    {
      $setOnInsert: {
        ...key,
        firedAt,
        slackThreadTs,
        startedNewThread: true,
        lastMessage: note,
        lastMessageAt: firedAt,
        messageCount: 1,
        updatedAt: firedAt,
      },
    },
    { upsert: true },
  )
}

export async function listIncidentOccurrences(input: {
  teamId: string
  triggerId: string
  incidentScope: string
  since?: Date
  limit?: number
}): Promise<SlackIncidentOccurrence[]> {
  return await slackIncidentOccurrences()
    .find({
      teamId: input.teamId,
      triggerId: input.triggerId,
      incidentScope: input.incidentScope,
      ...(input.since ? { firedAt: { $gte: input.since } } : {}),
    })
    .sort({ firedAt: -1 })
    .limit(Math.min(input.limit ?? 20, 50))
    .toArray()
}

/** Threads this alert has used, so a reply can be checked against its own history. */
export async function listIncidentThreadTss(input: {
  teamId: string
  triggerId: string
  incidentScope: string
  limit?: number
}): Promise<string[]> {
  const rows = await slackIncidentOccurrences()
    .find(
      {
        teamId: input.teamId,
        triggerId: input.triggerId,
        incidentScope: input.incidentScope,
        slackThreadTs: { $exists: true },
      },
      { projection: { slackThreadTs: 1 }, sort: { firedAt: -1 }, limit: input.limit ?? 50 },
    )
    .toArray()

  return [...new Set(rows.map((row) => row.slackThreadTs!).filter(Boolean))]
}

/** Whether a conversation is one this alert's own history recorded. */
export async function isIncidentOccurrenceSession(input: {
  teamId: string
  triggerId: string
  incidentScope: string
  sessionId: string
}): Promise<boolean> {
  const found = await slackIncidentOccurrences().findOne(
    {
      teamId: input.teamId,
      triggerId: input.triggerId,
      incidentScope: input.incidentScope,
      sessionId: input.sessionId,
    },
    { projection: { _id: 1 } },
  )

  return found !== null
}

export async function clearIncidentOccurrencesForTrigger(
  triggerId: string,
  teamId?: string,
): Promise<void> {
  await slackIncidentOccurrences().deleteMany({
    triggerId,
    ...(teamId ? { teamId } : {}),
  })
}
