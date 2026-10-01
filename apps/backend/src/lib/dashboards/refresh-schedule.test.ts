import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

type Doc = Record<string, unknown>

const teamId = new ObjectId()
const daily = new ObjectId()
const weekly = new ObjectId()
let panels: Doc[] = []
let triggers: Doc[] = []
let dashboards: Doc[] = []
let calls: { collection: string; op: string; args: unknown[] }[] = []

function collection(name: string) {
  const record =
    (op: string, result: unknown = { modifiedCount: 1 }) =>
    (...args: unknown[]) => {
      calls.push({ collection: name, op, args })

      return Promise.resolve(result)
    }
  const rows = () => (name === 'cost_panels' ? panels : name === 'agent_triggers' ? triggers : [])

  return {
    find: () => ({ toArray: () => Promise.resolve(rows()) }),
    updateOne: record('updateOne'),
    updateMany: record('updateMany'),
    deleteMany: record('deleteMany'),
    findOneAndUpdate: (filter: Doc, ...rest: unknown[]) => {
      calls.push({ collection: name, op: 'findOneAndUpdate', args: [filter, ...rest] })
      const index = dashboards.findIndex((d) => d.cadence === filter.cadence)

      return Promise.resolve(index === -1 ? null : dashboards.splice(index, 1)[0])
    },
  }
}

useDb({ db: () => ({ collection }) })

const { dashboardCadenceUpdate, nextScheduledRefresh } = await import('./refresh-cadence')
const { migratePanelCadencesToDashboards } = await import('./refresh-schedule-migration')
const { runDueDashboardRefreshes } = await import('./refresh-schedule')

beforeEach(() => {
  panels = []
  triggers = []
  dashboards = []
  calls = []
})

describe('nextScheduledRefresh', () => {
  const after = new Date('2026-09-23T10:00:00Z')

  test('fires at 09:00 UTC on the cadence boundary', () => {
    expect(nextScheduledRefresh('daily', after).toISOString()).toBe('2026-09-24T09:00:00.000Z')
    expect(nextScheduledRefresh('weekly', after).toISOString()).toBe('2026-09-28T09:00:00.000Z')
    expect(nextScheduledRefresh('monthly', after).toISOString()).toBe('2026-10-01T09:00:00.000Z')
  })
})

describe('dashboardCadenceUpdate', () => {
  const now = new Date('2026-09-23T10:00:00Z')

  test('leaves an unchanged cadence, and its overdue slot, alone', () => {
    expect(dashboardCadenceUpdate({ cadence: 'daily' }, 'daily', now)).toEqual({
      set: {},
      unset: {},
    })
    expect(dashboardCadenceUpdate({}, null, now)).toEqual({ set: {}, unset: {} })
  })

  test('arms a new cadence at its next slot and clears a removed one', () => {
    expect(dashboardCadenceUpdate({ cadence: 'daily' }, 'weekly', now).set).toEqual({
      cadence: 'weekly',
      nextRefreshAt: new Date('2026-09-28T09:00:00Z'),
    })
    expect(dashboardCadenceUpdate({ cadence: 'daily' }, null, now).unset).toEqual({
      cadence: '',
      nextRefreshAt: '',
    })
  })
})

describe('migratePanelCadencesToDashboards', () => {
  test('moves the most frequent panel cadence onto each dashboard and drops the triggers', async () => {
    const now = new Date('2026-09-23T10:00:00Z')
    const triggerId = new ObjectId()

    panels = [
      { _id: new ObjectId(), teamId, dashboardId: daily, cadence: 'monthly' },
      { _id: new ObjectId(), teamId, dashboardId: daily, cadence: 'daily' },
      { _id: new ObjectId(), teamId, dashboardId: weekly, cadence: 'weekly' },
    ]
    triggers = [{ _id: triggerId }]

    await migratePanelCadencesToDashboards(now)

    const scheduled = calls
      .filter((call) => call.collection === 'cost_dashboards' && call.op === 'updateOne')
      .map((call) => [(call.args[0] as Doc)._id, (call.args[1] as { $set: Doc }).$set])

    expect(scheduled).toEqual([
      [daily, { cadence: 'daily', nextRefreshAt: new Date('2026-09-24T09:00:00Z') }],
      [weekly, { cadence: 'weekly', nextRefreshAt: new Date('2026-09-28T09:00:00Z') }],
    ])
    expect(
      calls.find((call) => call.collection === 'cost_panels' && call.op === 'updateMany')?.args[1],
    ).toEqual({ $unset: { cadence: '', cadenceTriggerId: '' } })
    expect(
      calls.find((call) => call.collection === 'agent_triggers' && call.op === 'deleteMany')
        ?.args[0],
    ).toEqual({ _id: { $in: [triggerId] } })
  })

  test('is a no-op once nothing is left to migrate', async () => {
    await migratePanelCadencesToDashboards()

    expect(calls.filter((call) => call.op !== 'find')).toEqual([])
  })
})

describe('runDueDashboardRefreshes', () => {
  test('claims each due dashboard once and advances its next slot', async () => {
    const now = new Date('2026-09-23T09:00:30Z')

    dashboards = [
      { _id: daily, teamId, cadence: 'daily', layout: [], timeRange: {} },
      { _id: weekly, teamId, cadence: 'weekly', layout: [], timeRange: {} },
    ]

    expect(await runDueDashboardRefreshes(now)).toBe(2)

    const claims = calls.filter((call) => call.op === 'findOneAndUpdate')
    const firstClaim = claims[0]?.args as [Doc, { $set: Doc }]

    expect(firstClaim[0]).toEqual({ cadence: 'daily', nextRefreshAt: { $lte: now } })
    expect(firstClaim[1].$set).toEqual({
      nextRefreshAt: new Date('2026-09-24T09:00:00Z'),
      lastScheduledRefreshAt: now,
    })
    expect(await runDueDashboardRefreshes(now)).toBe(0)
  })
})
