import { describe, expect, mock, test } from 'bun:test'

import { MISSED_RUN_GRACE_MS, findMissedRun, sweepMissedTriggerRuns } from './trigger-missed-runs'

import type { AgentTrigger } from './trigger-db'
import type { MissedRunSweepDeps } from './trigger-missed-runs'
import type { ObjectId } from 'mongodb'

const DAILY_9 = '0 9 * * *'
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z')
const NOW = new Date('2026-11-13T09:20:00.000Z')
const DUE = new Date('2026-11-13T09:00:00.000Z')
// A replica that started long before any fire under test.
const STARTED_EARLY = LONG_AGO

function trigger(overrides: Partial<AgentTrigger> = {}): AgentTrigger {
  return {
    _id: { toString: () => 'trigger-1' } as ObjectId,
    userId: 'owner',
    teamId: 'team-1',
    name: 'Morning digest',
    triggerType: 'cron',
    cronExpression: DAILY_9,
    timeZone: 'UTC',
    targetSessionId: 'session-1',
    messageTemplate: 'go',
    enabled: true,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    ...overrides,
  }
}

describe('findMissedRun', () => {
  test('reports the due fire when nothing has fired since', () => {
    const fired = new Date('2026-11-12T09:00:01.000Z')

    expect(findMissedRun(trigger({ lastFiredAt: fired }), NOW, STARTED_EARLY)).toEqual(DUE)
  })

  test('is quiet when the due fire happened, even if its turn is still running', () => {
    const fired = new Date('2026-11-13T09:00:02.000Z')

    expect(findMissedRun(trigger({ lastFiredAt: fired }), NOW, STARTED_EARLY)).toBeNull()
  })

  test('waits out the grace period before calling a fire missed', () => {
    const justDue = new Date(DUE.getTime() + MISSED_RUN_GRACE_MS - 1000)
    const overdue = new Date(DUE.getTime() + MISSED_RUN_GRACE_MS)
    const fired = new Date('2026-11-12T09:00:01.000Z')

    expect(findMissedRun(trigger({ lastFiredAt: fired }), justDue, STARTED_EARLY)).toBeNull()
    expect(findMissedRun(trigger({ lastFiredAt: fired }), overdue, STARTED_EARLY)).toEqual(DUE)
  })

  test('never reports a schedule created after the due time', () => {
    const created = new Date('2026-11-13T09:10:00.000Z')

    expect(findMissedRun(trigger({ createdAt: created }), NOW, STARTED_EARLY)).toBeNull()
  })

  test('never reports a schedule edited after the due time', () => {
    const edited = new Date('2026-11-13T09:05:00.000Z')

    expect(findMissedRun(trigger({ updatedAt: edited }), NOW, STARTED_EARLY)).toBeNull()
  })

  test('reads the cron in the trigger time zone', () => {
    // 09:00 in Stockholm (UTC+1 in November) is 08:00 UTC.
    const stockholm = trigger({ timeZone: 'Europe/Stockholm' })

    expect(findMissedRun(stockholm, NOW, STARTED_EARLY)).toEqual(
      new Date('2026-11-13T08:00:00.000Z'),
    )
    // 08:20 UTC is 09:20 in Stockholm, but still before 09:00 in New York.
    const earlier = new Date('2026-11-13T08:20:00.000Z')
    const newYork = trigger({ timeZone: 'America/New_York' })

    expect(findMissedRun(newYork, earlier, STARTED_EARLY)).toEqual(
      new Date('2026-11-12T14:00:00.000Z'),
    )
  })

  test('falls back to lastRunAt for a legacy row', () => {
    const ranToday = trigger({ lastRunAt: new Date('2026-11-13T09:04:00.000Z') })
    const ranYesterday = trigger({ lastRunAt: new Date('2026-11-12T09:04:00.000Z') })

    expect(findMissedRun(ranToday, NOW, STARTED_EARLY)).toBeNull()
    expect(findMissedRun(ranYesterday, NOW, STARTED_EARLY)).toEqual(DUE)
  })

  test('first sweep after deploy ignores a legacy row whose last fire is long past', () => {
    // lastRunAt is only written on a successful turn: a failed or long
    // turn looks like a miss, so before the row fires under the new code
    // only fires due after this process started may be reported.
    const legacy = trigger({ lastRunAt: new Date('2026-10-01T09:04:00.000Z') })
    const startedAfterDue = new Date('2026-11-13T09:10:00.000Z')
    const startedBeforeDue = new Date('2026-11-13T08:00:00.000Z')

    expect(findMissedRun(legacy, NOW, startedAfterDue)).toBeNull()
    expect(findMissedRun(legacy, NOW, startedBeforeDue)).toEqual(DUE)
  })

  test('the legacy floor does not apply once lastFiredAt exists', () => {
    const fired = trigger({ lastFiredAt: new Date('2026-11-12T09:00:01.000Z') })
    const startedAfterDue = new Date('2026-11-13T09:10:00.000Z')

    expect(findMissedRun(fired, NOW, startedAfterDue)).toEqual(DUE)
  })

  test('ignores disabled, expired and non-cron triggers', () => {
    const expired = new Date('2026-11-13T09:10:00.000Z')

    expect(findMissedRun(trigger({ enabled: false }), NOW, STARTED_EARLY)).toBeNull()
    expect(findMissedRun(trigger({ expiresAt: expired }), NOW, STARTED_EARLY)).toBeNull()
    expect(
      findMissedRun(
        trigger({ triggerType: 'webhook', cronExpression: undefined }),
        NOW,
        STARTED_EARLY,
      ),
    ).toBeNull()
  })
})

describe('sweepMissedTriggerRuns', () => {
  // One stored row that findOneAndUpdate treats like Mongo would for the
  // claim filter: the fields it re-checks, and the before-image it returns.
  function fakeDeps(initial: AgentTrigger, afterRead?: () => void) {
    const state = { row: initial, readRevision: initial.configRevision ?? 0 }
    const findOneAndUpdate = mock(
      (_filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const expected = (update.$set as { missedRunAt: Date }).missedRunAt
        const { row } = state
        const sameClaim = row.missedRunAt?.getTime() === expected.getTime()
        const fired = row.lastFiredAt && row.lastFiredAt.getTime() >= expected.getTime()
        const edited = (row.configRevision ?? 0) !== state.readRevision

        if (sameClaim || fired || edited || !row.enabled) return Promise.resolve(null)
        const before = { ...row }

        state.row = { ...row, missedRunAt: expected }

        return Promise.resolve(before)
      },
    )
    const notify = mock(() => {})
    const deps = {
      triggers: {
        find: () => ({
          toArray: () => {
            const snapshot = [state.row]

            state.readRevision = state.row.configRevision ?? 0
            afterRead?.()

            return Promise.resolve(snapshot)
          },
        }),
        findOneAndUpdate,
      },
      notify,
    } as unknown as MissedRunSweepDeps

    return { deps, state, findOneAndUpdate, notify }
  }

  const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000)

  test('alerts the owner once per missed fire however many replicas sweep', async () => {
    const row = trigger({
      userId: 'principal',
      lastFiredAt: new Date('2026-11-12T09:00:01.000Z'),
    })
    const { deps, notify } = fakeDeps(row)

    expect(await sweepMissedTriggerRuns(STARTED_EARLY, NOW, deps)).toBe(1)
    expect(await sweepMissedTriggerRuns(STARTED_EARLY, NOW, deps)).toBe(0)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(['principal'], {
      sessionId: 'session-1',
      teamId: 'team-1',
      title: 'Trigger missed a run',
      body: 'Morning digest was due at 2026-11-13 09:00 (UTC) and did not run.',
    })
  })

  test('alerts once per outage, and again after a fire ends it', async () => {
    const everyMinute = trigger({
      cronExpression: '* * * * *',
      lastFiredAt: new Date('2026-11-12T09:00:01.000Z'),
    })
    const { deps, state, notify } = fakeDeps(everyMinute)

    // Three sweeps, each seeing a newer missed occurrence.
    await sweepMissedTriggerRuns(STARTED_EARLY, minutes(0), deps)
    const first = state.row.missedRunAt

    await sweepMissedTriggerRuns(STARTED_EARLY, minutes(5), deps)
    await sweepMissedTriggerRuns(STARTED_EARLY, minutes(10), deps)
    expect(notify).toHaveBeenCalledTimes(1)
    // The marker still follows the latest missed occurrence.
    expect(state.row.missedRunAt?.getTime()).toBeGreaterThan(first?.getTime() ?? Infinity)
    expect(state.row.missedRunAt).toEqual(new Date(minutes(10).getTime() - MISSED_RUN_GRACE_MS))

    // The scheduler fires: lastFiredAt set, missedRunAt unset.
    const { missedRunAt: _cleared, ...rest } = state.row

    state.row = { ...rest, lastFiredAt: minutes(11) }
    await sweepMissedTriggerRuns(STARTED_EARLY, minutes(12), deps)
    expect(notify).toHaveBeenCalledTimes(1)

    // A new outage after that fire alerts again.
    await sweepMissedTriggerRuns(STARTED_EARLY, minutes(40), deps)
    await sweepMissedTriggerRuns(STARTED_EARLY, minutes(45), deps)
    expect(notify).toHaveBeenCalledTimes(2)
  })

  test('claims with a filter that fails once a fire or edit has landed', async () => {
    const row = trigger({ lastFiredAt: new Date('2026-11-12T09:00:01.000Z') })
    const { deps, findOneAndUpdate } = fakeDeps(row)

    await sweepMissedTriggerRuns(STARTED_EARLY, NOW, deps)
    expect(findOneAndUpdate.mock.calls[0]?.[0]).toMatchObject({
      enabled: true,
      missedRunAt: { $ne: DUE },
      $and: [
        { $or: [{ configRevision: 0 }, { configRevision: { $exists: false } }] },
        { $or: [{ lastFiredAt: { $exists: false } }, { lastFiredAt: { $lt: DUE } }] },
      ],
    })
  })

  test('an edit between read and claim cancels the alert', async () => {
    const row = trigger({ lastFiredAt: new Date('2026-11-12T09:00:01.000Z'), configRevision: 3 })
    // The edit lands right after the sweep read the row.
    const { deps, state, notify } = fakeDeps(row, () => {
      state.row = { ...state.row, configRevision: 4 }
    })

    expect(await sweepMissedTriggerRuns(STARTED_EARLY, NOW, deps)).toBe(0)
    expect(notify).not.toHaveBeenCalled()
  })

  test('a row that throws does not stop the next row from alerting', async () => {
    const broken = trigger({ _id: { toString: () => 'broken' } as ObjectId })
    const healthy = trigger({ _id: { toString: () => 'healthy' } as ObjectId })
    const notify = mock(() => {})
    const findOneAndUpdate = mock((filter: { _id: ObjectId }) =>
      filter._id.toString() === 'broken'
        ? Promise.reject(new Error('write failed'))
        : Promise.resolve({}),
    )
    const deps = {
      triggers: {
        find: () => ({ toArray: () => Promise.resolve([broken, healthy]) }),
        findOneAndUpdate,
      },
      notify,
    } as unknown as MissedRunSweepDeps

    expect(await sweepMissedTriggerRuns(STARTED_EARLY, NOW, deps)).toBe(1)
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  test('does not claim or alert for a trigger that ran', async () => {
    const row = trigger({ lastFiredAt: new Date('2026-11-13T09:00:01.000Z') })
    const { deps, findOneAndUpdate, notify } = fakeDeps(row)

    expect(await sweepMissedTriggerRuns(STARTED_EARLY, NOW, deps)).toBe(0)
    expect(findOneAndUpdate).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})
