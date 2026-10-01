import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import {
  panelExecutionPrincipal,
  panelSnapshotKey,
  presetWindow,
  resolveParams,
} from '@/lib/dashboards/exec-service'

import type { NuphosDashboard, DashboardPanel } from '@/models'

// Fixed ids so resolveParams (which now injects teamId) hashes deterministically
// across helper calls.
const FIXED_DASH_ID = new ObjectId('0000000000000000000000d1')
const FIXED_TEAM_ID = new ObjectId('0000000000000000000000a1')

function dashboard(overrides: Partial<NuphosDashboard> = {}): NuphosDashboard {
  const now = new Date('2026-07-16T00:00:00.000Z')

  return {
    _id: FIXED_DASH_ID,
    teamId: FIXED_TEAM_ID,
    name: 'd',
    layout: [],
    timeRange: {
      periodStart: new Date('2026-06-15T00:00:00.000Z'),
      periodEnd: new Date('2026-07-15T00:00:00.000Z'),
      granularity: 'day',
    },
    createdBy: 'u1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function panel(overrides: Partial<DashboardPanel> = {}): DashboardPanel {
  const now = new Date('2026-07-16T00:00:00.000Z')

  return {
    _id: new ObjectId(),
    teamId: new ObjectId(),
    dashboardId: new ObjectId(),
    title: 'p',
    kind: 'chart',
    scriptVersion: 1,
    versions: [{ version: 1, code: 'emit({})', codeHash: 'h', authoredBy: 'u1', createdAt: now }],
    createdBy: 'u1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('panelExecutionPrincipal', () => {
  test('uses the current script version author', () => {
    const authorId = new ObjectId().toHexString()

    expect(panelExecutionPrincipal(panel(), authorId)).toBe(authorId)
  })

  test('falls back to the panel creator for a legacy invalid author id', () => {
    const creatorId = new ObjectId().toHexString()

    expect(panelExecutionPrincipal(panel({ createdBy: creatorId }), 'legacy-user')).toBe(creatorId)
  })
})

describe('resolveParams', () => {
  test('inherits the dashboard time range', () => {
    const { params } = resolveParams(dashboard(), panel())

    expect(params.periodStart).toBe('2026-06-15T00:00:00.000Z')
    expect(params.periodEnd).toBe('2026-07-15T00:00:00.000Z')
    expect(params.granularity).toBe('day')
  })

  test('time window always comes from the dashboard, even if staticParams tries to set it', () => {
    // A panel can NOT shadow the dashboard time window via staticParams.
    const { params } = resolveParams(
      dashboard(),
      panel({ staticParams: { periodStart: '1999-01-01T00:00:00.000Z', provider: 'hetzner' } }),
    )

    expect(params.periodStart).toBe('2026-06-15T00:00:00.000Z')
    expect(params.provider).toBe('hetzner')
  })

  test('merges staticParams', () => {
    const { params } = resolveParams(
      dashboard(),
      panel({ staticParams: { provider: 'hetzner', accountId: 'a1' } }),
    )

    expect(params.provider).toBe('hetzner')
    expect(params.accountId).toBe('a1')
  })

  test('paramsHash is stable regardless of staticParams key order', () => {
    const a = resolveParams(
      dashboard(),
      panel({ staticParams: { provider: 'hetzner', accountId: 'a1' } }),
    )
    const b = resolveParams(
      dashboard(),
      panel({ staticParams: { accountId: 'a1', provider: 'hetzner' } }),
    )

    expect(a.paramsHash).toBe(b.paramsHash)
  })

  test('paramsHash changes when the dashboard time range changes', () => {
    const a = resolveParams(dashboard(), panel())
    const b = resolveParams(
      dashboard({
        timeRange: {
          periodStart: new Date('2026-07-01T00:00:00.000Z'),
          periodEnd: new Date('2026-07-15T00:00:00.000Z'),
          granularity: 'day',
        },
      }),
      panel(),
    )

    expect(a.paramsHash).not.toBe(b.paramsHash)
  })
})

describe('panelSnapshotKey', () => {
  test('binds a snapshot to the dashboard range and head script', () => {
    const current = panel()
    const edited = panel({
      ...current,
      scriptVersion: 2,
      versions: [
        ...current.versions,
        {
          version: 2,
          code: 'emit({ updated: true })',
          codeHash: 'updated',
          authoredBy: 'u1',
          createdAt: current.createdAt,
        },
      ],
    })
    const priorRange = dashboard({
      timeRange: {
        periodStart: new Date('2026-06-01T00:00:00.000Z'),
        periodEnd: new Date('2026-06-30T00:00:00.000Z'),
        granularity: 'day',
      },
    })

    expect(panelSnapshotKey(dashboard(), edited).codeHash).toBe('updated')
    expect(panelSnapshotKey(priorRange, current).paramsHash).not.toBe(
      panelSnapshotKey(dashboard(), current).paramsHash,
    )
  })
})

describe('presetWindow', () => {
  const noonUtc = new Date('2026-07-17T12:00:00.000Z')

  test('last7 is the 7 days up to and including today', () => {
    const { periodStart, periodEnd } = presetWindow('last7', noonUtc)

    expect(periodStart.toISOString()).toBe('2026-07-11T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-07-17T23:59:59.999Z')
  })

  test('last14 is the 14 days up to and including today', () => {
    const { periodStart, periodEnd } = presetWindow('last14', noonUtc)

    expect(periodStart.toISOString()).toBe('2026-07-04T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-07-17T23:59:59.999Z')
  })

  test('last30 is the 30 days up to and including today, on UTC day boundaries', () => {
    const { periodStart, periodEnd } = presetWindow('last30', noonUtc)

    expect(periodStart.toISOString()).toBe('2026-06-18T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-07-17T23:59:59.999Z')
  })

  test('thisMonth starts at the 1st (UTC) and ends at end of today', () => {
    const { periodStart, periodEnd } = presetWindow('thisMonth', noonUtc)

    expect(periodStart.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-07-17T23:59:59.999Z')
  })

  test('prevMonth spans the whole previous calendar month', () => {
    const { periodStart, periodEnd } = presetWindow('prevMonth', noonUtc)

    expect(periodStart.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(periodEnd.toISOString()).toBe('2026-06-30T23:59:59.999Z')
  })

  test('is stable within a UTC day (so snapshots reuse) but moves the next day', () => {
    const early = presetWindow('last30', new Date('2026-07-17T00:30:00.000Z'))
    const late = presetWindow('last30', new Date('2026-07-17T23:30:00.000Z'))

    expect(late.periodStart.getTime()).toBe(early.periodStart.getTime())
    expect(late.periodEnd.getTime()).toBe(early.periodEnd.getTime())
    const nextDay = presetWindow('last30', new Date('2026-07-18T00:30:00.000Z'))

    expect(nextDay.periodStart.getTime()).not.toBe(early.periodStart.getTime())
  })
})
