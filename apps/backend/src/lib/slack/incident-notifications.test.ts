import { describe, expect, test } from 'bun:test'

import {
  planSlackIncidentPost,
  SLACK_INCIDENT_POST_WINDOW_MS,
  SLACK_INCIDENT_RUNAWAY_POSTS_PER_HOUR,
  slackIncidentRevisionFilter,
} from './incident-notifications'

import type { SlackNotificationIncident } from './incident-notifications'

const now = new Date('2026-07-15T00:00:00.000Z')

function record(overrides: Partial<SlackNotificationIncident> = {}): SlackNotificationIncident {
  return {
    teamId: 'team-1',
    slackWorkspaceId: 'T1',
    slackChannelId: 'C1',
    triggerId: 'trigger-1',
    incidentScope: 'default',
    latestThreadTs: '111.222',
    latestSessionId: 'session-1',
    lastContentHash: 'old-hash',
    lastNotificationAt: new Date(now.getTime() - 5 * 60_000),
    postWindowStartedAt: new Date(now.getTime() - 30 * 60_000),
    postCountInWindow: 1,
    totalPostCount: 1,
    createdAt: new Date(now.getTime() - 60 * 60_000),
    updatedAt: new Date(now.getTime() - 5 * 60_000),
    ...overrides,
  }
}

describe('outbound incident post policy', () => {
  test('only mechanical reasons can stop a message', () => {
    // Whether a message is worth sending is the agent's call, so the policy may
    // refuse only things the agent could not have known.
    expect(
      planSlackIncidentPost(null, { placement: { type: 'new_thread' }, contentHash: 'a' }, now),
    ).toEqual({ action: 'post_root' })
    expect(
      planSlackIncidentPost(
        record(),
        { placement: { type: 'new_thread' }, contentHash: 'fresh' },
        now,
      ),
    ).toEqual({ action: 'post_root' })
    // Seconds after the last message, with a thread already open and three
    // posts this hour, a further message is still the agent's to send.
    expect(
      planSlackIncidentPost(
        record({ lastNotificationAt: now, postCountInWindow: 3 }),
        { placement: { type: 'reply', threadTs: '111.222' }, contentHash: 'fresh' },
        now,
      ),
    ).toEqual({ action: 'post_thread', threadTs: '111.222' })
  })

  test('refuses a byte-identical repeat, which is a retry rather than a decision', () => {
    expect(
      planSlackIncidentPost(
        record({ lastContentHash: 'same' }),
        { placement: { type: 'reply', threadTs: '111.222' }, contentHash: 'same' },
        now,
      ),
    ).toEqual({ action: 'suppress', reason: 'duplicate_content' })
  })

  test('refuses while another delivery holds the lease', () => {
    expect(
      planSlackIncidentPost(
        record({
          pending: {
            token: 'lease',
            action: 'post_root',
            contentHash: 'other',
            sessionId: 'session-2',
            triggerConfigRevision: 1,
            expiresAt: new Date(now.getTime() + 60_000),
          },
        }),
        { placement: { type: 'new_thread' }, contentHash: 'fresh' },
        now,
      ),
    ).toEqual({ action: 'suppress', reason: 'concurrent_delivery' })
  })

  test('stops a loop, but only far past any human posting rate', () => {
    expect(
      planSlackIncidentPost(
        record({
          postWindowStartedAt: new Date(now.getTime() - 10 * 60_000),
          postCountInWindow: SLACK_INCIDENT_RUNAWAY_POSTS_PER_HOUR,
        }),
        { placement: { type: 'new_thread' }, contentHash: 'x' },
        now,
      ),
    ).toEqual({ action: 'suppress', reason: 'runaway_guard' })

    // The same count in an expired window is not a loop.
    expect(
      planSlackIncidentPost(
        record({
          postWindowStartedAt: new Date(now.getTime() - SLACK_INCIDENT_POST_WINDOW_MS),
          postCountInWindow: SLACK_INCIDENT_RUNAWAY_POSTS_PER_HOUR,
        }),
        { placement: { type: 'new_thread' }, contentHash: 'x' },
        now,
      ),
    ).toEqual({ action: 'post_root' })
  })

  test('a reply must land in a thread this alert actually owns', () => {
    expect(
      planSlackIncidentPost(
        record(),
        { placement: { type: 'reply', threadTs: '999.999' }, contentHash: 'x' },
        now,
      ),
    ).toEqual({ action: 'suppress', reason: 'unknown_thread' })

    // An older thread of this alert, proven by the ledger, is fine.
    expect(
      planSlackIncidentPost(
        record(),
        {
          placement: { type: 'reply', threadTs: '999.999' },
          contentHash: 'x',
          threadBelongsToAlert: true,
        },
        now,
      ),
    ).toEqual({ action: 'post_thread', threadTs: '999.999' })
  })

  test('reads a row the previous release wrote, so a rolling deploy keeps the thread', () => {
    // Old and new pods run side by side during a rollout, and an old pod writes
    // rootThreadTs / updateCountInWindow. Failing to read those would make the
    // new code open a second thread for an incident that already has one.
    const legacy: SlackNotificationIncident = {
      teamId: 'team-1',
      slackWorkspaceId: 'T1',
      slackChannelId: 'C1',
      triggerId: 'trigger-1',
      incidentScope: 'default',
      state: 'open',
      generation: 2,
      rootThreadTs: '111.222',
      rootSessionId: 'session-1',
      updateWindowStartedAt: new Date(now.getTime() - 10 * 60_000),
      updateCountInWindow: 2,
      totalUpdateCount: 5,
      postCountInWindow: 0,
      totalPostCount: 0,
      createdAt: new Date(now.getTime() - 60 * 60_000),
      updatedAt: now,
    }

    // Its thread is recognised without the ledger having been consulted.
    expect(
      planSlackIncidentPost(
        legacy,
        { placement: { type: 'reply', threadTs: '111.222' }, contentHash: 'x' },
        now,
      ),
    ).toEqual({ action: 'post_thread', threadTs: '111.222' })

    // And its posting rate is read from the old counters.
    expect(
      planSlackIncidentPost(
        { ...legacy, updateCountInWindow: SLACK_INCIDENT_RUNAWAY_POSTS_PER_HOUR },
        { placement: { type: 'new_thread' }, contentHash: 'x' },
        now,
      ),
    ).toEqual({ action: 'suppress', reason: 'runaway_guard' })
  })

  test('a failed ledger read cannot veto a thread the record itself points at', async () => {
    // The call site reads the ledger best-effort and catches to []. Treating a
    // resulting `false` as a veto would tell the agent its own thread is foreign
    // and send it to open a new one — the spam this layer exists to prevent.
    expect(
      planSlackIncidentPost(
        record(),
        {
          placement: { type: 'reply', threadTs: '111.222' },
          contentHash: 'x',
          threadBelongsToAlert: false,
        },
        now,
      ),
    ).toEqual({ action: 'post_thread', threadTs: '111.222' })

    // A thread the record does not point at is still refused.
    expect(
      planSlackIncidentPost(
        record(),
        {
          placement: { type: 'reply', threadTs: '777.777' },
          contentHash: 'x',
          threadBelongsToAlert: false,
        },
        now,
      ),
    ).toEqual({ action: 'suppress', reason: 'unknown_thread' })
  })

  test('uses monotonic revisions even when two writes share the same timestamp', () => {
    expect(slackIncidentRevisionFilter(record({ revision: 7 }))).toEqual({ revision: 7 })
    expect(slackIncidentRevisionFilter(record({ revision: undefined }))).toEqual({
      $or: [{ revision: 0 }, { revision: { $exists: false } }],
    })
  })
})
