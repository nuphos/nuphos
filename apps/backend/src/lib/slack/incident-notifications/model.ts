import { db } from '@/lib/db'

import type { SlackOutboundDestination } from '@/lib/slack/destinations'
import type { Collection, ObjectId } from 'mongodb'

/** Server-owned context attached to a run fired by one monitoring trigger. */
export type SlackTriggerNotificationContext = {
  triggerId: string
  /** Isolates members that share one Watch Group ingress. */
  incidentScope: string
  /** Persisted execution fence captured when this run loaded the trigger. */
  triggerConfigRevision: number
  /** Immutable destination approved when the trigger was created. */
  approvedDestination: SlackOutboundDestination
}

/**
 * Where a message goes — an address, not a classification.
 *
 * An on-call engineer does not label their Slack messages. They decide whether
 * to start a thread or reply in an existing one, and write. Everything the
 * server needs follows from that choice, so that is the only thing the model
 * is asked for.
 */
export type SlackIncidentPlacement = { type: 'new_thread' } | { type: 'reply'; threadTs: string }

/**
 * Every remaining reason is mechanical: something the model cannot know and
 * could not have decided differently. Judgments about whether a message is
 * worth sending belong to the model and are not represented here.
 */
export type SlackIncidentSuppressionReason =
  // Another replica or retry is mid-delivery for this alert.
  | 'concurrent_delivery'
  // Byte-identical to the message already delivered — a retry, not a decision.
  | 'duplicate_content'
  // Far past any plausible human posting rate: a loop, not an opinion.
  | 'runaway_guard'
  // The thread does not belong to this alert.
  | 'unknown_thread'

export type SlackIncidentPendingAction = {
  token: string
  action: 'post_root' | 'post_thread'
  contentHash: string
  sessionId: string
  triggerConfigRevision: number
  expiresAt: Date
  /** Durable evidence recorded immediately after Slack accepts the message. */
  delivery?: {
    rootThreadTs: string
    agentUserId: string
    createdBySlackUserId?: string
    deliveredAt: Date
  }
}

/**
 * Delivery safety for one alert's destination. Deliberately not a lifecycle:
 * there is no open/resolved state here, because "is this incident over" is a
 * judgment, and the only consumer of the answer was the server itself. What
 * happened, and when, lives in the occurrence ledger.
 */
export type SlackNotificationIncident = {
  _id?: ObjectId
  teamId: string
  slackWorkspaceId: string
  slackChannelId: string
  triggerId: string
  /** `default` for standalone Watches; member key for shared Watch Groups. */
  incidentScope: string
  /** Trigger execution revision that owns this record. */
  triggerConfigRevision?: number
  /** Monotonic compare-and-swap token; legacy rows without it are revision 0. */
  revision?: number
  /** The most recent thread this alert opened, for thread validation. */
  latestThreadTs?: string
  latestSessionId?: string
  lastContentHash?: string
  lastNotificationAt?: Date
  /** Rolling counters — shown to the model, enforced only at the runaway edge.
   *  Absent on rows the previous release created. */
  postWindowStartedAt?: Date
  postCountInWindow?: number
  totalPostCount?: number
  pending?: SlackIncidentPendingAction
  createdAt: Date
  updatedAt: Date
  /**
   * Written and read by the previous release, kept alive for one rollout.
   * Old and new pods run side by side during a rolling deploy, and the old one
   * finds a live incident by `{ state: 'open', rootSessionId }` — so dropping
   * these would make an old pod unable to locate the thread while still
   * refusing to open a new one, which silences that firing entirely.
   * Safe to delete once the release is fully rolled out.
   */
  state?: 'pending_initial' | 'open' | 'resolved'
  generation?: number
  rootThreadTs?: string
  rootSessionId?: string
  updateWindowStartedAt?: Date
  updateCountInWindow?: number
  totalUpdateCount?: number
  resolvedAt?: Date
  investigationResultAt?: Date
}

export type SlackIncidentReservation = {
  recordId: ObjectId
  token: string
  action: 'post_root' | 'post_thread'
  contentHash: string
  sessionId: string
  triggerConfigRevision: number
  createdNew: boolean
  threadTs?: string
  postWindowStartedAt?: Date
  postCountInWindow: number
  /** Incident identity, so completion can append to the ledger without a read. */
  identity: SlackIncidentIdentity
}

export type SlackIncidentIdentity = {
  teamId: string
  triggerId: string
  incidentScope: string
  slackWorkspaceId: string
  slackChannelId: string
}

export type SlackIncidentReserveResult =
  | { action: 'suppress'; reason: SlackIncidentSuppressionReason; threadTs?: string }
  | { action: 'post_root' | 'post_thread'; reservation: SlackIncidentReservation }

export type SlackIncidentActionPlan =
  | { action: 'suppress'; reason: SlackIncidentSuppressionReason }
  | { action: 'post_root' }
  | { action: 'post_thread'; threadTs: string }

const COLLECTION = 'slack_notification_incidents'

export const RESERVATION_LEASE_MS = 2 * 60_000

/**
 * The rate an on-call is shown so they can moderate themselves, and the rate
 * at which the server stops believing a human decision is behind the messages.
 * The soft number is advisory: exceeding it is the model's call to make, and
 * only observed. The hard number exists to stop a loop, not to win an argument
 * about whether an update was worth sending.
 */
export const SLACK_INCIDENT_BUSY_POSTS_PER_HOUR = 3
export const SLACK_INCIDENT_RUNAWAY_POSTS_PER_HOUR = 12
export const SLACK_INCIDENT_POST_WINDOW_MS = 60 * 60_000

export const slackNotificationIncidents = (): Collection<SlackNotificationIncident> =>
  db().collection<SlackNotificationIncident>(COLLECTION)

/** A row the previous release wrote carries the same facts under other names. */
export function threadPointer(existing: SlackNotificationIncident | null): string | undefined {
  return existing?.latestThreadTs ?? existing?.rootThreadTs
}

/**
 * Both releases count posts, under different field names, and during a rollout
 * either may have written last: an old pod bumps only its own counter, leaving
 * ours stale. Taking the larger count and the later window keeps the rate we
 * report at least as high as reality, so the runaway guard cannot be walked
 * past by alternating which pod handles a firing.
 */
export function postCountInWindow(existing: SlackNotificationIncident | null, now: Date): number {
  if (!existing) return 0
  const windows = [existing.postWindowStartedAt, existing.updateWindowStartedAt].filter(
    (at): at is Date => at instanceof Date,
  )

  if (windows.length === 0) return 0
  const startedAt = new Date(Math.max(...windows.map((at) => at.getTime())))

  if (now.getTime() - startedAt.getTime() >= SLACK_INCIDENT_POST_WINDOW_MS) return 0

  return Math.max(existing.postCountInWindow ?? 0, existing.updateCountInWindow ?? 0)
}

/**
 * Pure policy for one outbound message. Every branch here is something the
 * model could not have known or decided; the question "should this be said at
 * all" is deliberately absent.
 */
export function planSlackIncidentPost(
  existing: SlackNotificationIncident | null,
  input: {
    placement: SlackIncidentPlacement
    contentHash: string
    /** Whether the requested thread belongs to this alert (ledger-checked). */
    threadBelongsToAlert?: boolean
  },
  now: Date,
): SlackIncidentActionPlan {
  if (existing?.pending && existing.pending.expiresAt.getTime() > now.getTime()) {
    return { action: 'suppress', reason: 'concurrent_delivery' }
  }
  if (existing?.lastContentHash === input.contentHash) {
    return { action: 'suppress', reason: 'duplicate_content' }
  }
  if (postCountInWindow(existing, now) >= SLACK_INCIDENT_RUNAWAY_POSTS_PER_HOUR) {
    return { action: 'suppress', reason: 'runaway_guard' }
  }
  if (input.placement.type === 'reply') {
    // The ledger is additive evidence, never a veto. Its read is best-effort at
    // the call site, and a row can be missing because a history write failed —
    // so a `false` here must not override the record still pointing at this
    // exact thread. Treating it as a veto would tell the agent its own thread
    // is foreign and send it to open a new one: the spam this layer prevents.
    const known =
      input.threadBelongsToAlert === true || threadPointer(existing) === input.placement.threadTs

    if (!known) return { action: 'suppress', reason: 'unknown_thread' }

    return { action: 'post_thread', threadTs: input.placement.threadTs }
  }

  return { action: 'post_root' }
}

export function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number }).code === 11000
}

/** Mongo CAS selector; legacy rows without a revision are treated as zero. */
export function slackIncidentRevisionFilter(
  existing: Pick<SlackNotificationIncident, 'revision'>,
): { revision: number } | { $or: ({ revision: number } | { revision: { $exists: false } })[] } {
  return existing.revision === undefined
    ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
    : { revision: existing.revision }
}
