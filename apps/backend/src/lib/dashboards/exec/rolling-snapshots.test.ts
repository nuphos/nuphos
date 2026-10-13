import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { presetWindow, resolveParams, rollingSnapshotHashes } from './params'

import type { DashboardPanel, DashboardRangePreset, NuphosDashboard } from '@/models'

const dashboard = {
  teamId: new ObjectId(),
  timeRange: { ...presetWindow('thisMonth', new Date('2026-10-09T05:15:00Z')), granularity: 'day' },
} as NuphosDashboard
const panel: DashboardPanel = {
  _id: new ObjectId(),
  teamId: dashboard.teamId,
  dashboardId: new ObjectId(),
  title: 'Cost',
  kind: 'scalar',
  scriptVersion: 1,
  versions: [],
  staticParams: { currency: 'USD' },
  createdBy: 'u1',
  createdAt: new Date(),
  updatedAt: new Date(),
}
const hash = (preset: DashboardRangePreset, date: string, source = panel) =>
  resolveParams(
    {
      ...dashboard,
      timeRange: { ...dashboard.timeRange, ...presetWindow(preset, new Date(date)) },
    },
    source,
  ).paramsHash

describe('rolling snapshot fallback', () => {
  test('keeps earlier successful windows within this month after UTC midnight', () => {
    const hashes = rollingSnapshotHashes(dashboard, panel, 'thisMonth')

    expect(hashes).toHaveLength(8)
    expect(hashes[0]).toBe(hash('thisMonth', '2026-10-08T09:00:00Z'))
    expect(hashes).toContain(hash('thisMonth', '2026-10-01T09:00:00Z'))
    expect(hashes).not.toContain(hash('thisMonth', '2026-09-30T09:00:00Z'))
    expect(hashes).not.toContain(hash('last7', '2026-10-08T09:00:00Z'))
    expect(hashes).not.toContain(hash('thisMonth', '2026-10-09T09:00:00Z'))
  })

  test('custom ranges and previous month require an exact match', () => {
    expect(rollingSnapshotHashes(dashboard, panel)).toEqual([])
    expect(rollingSnapshotHashes(dashboard, panel, 'prevMonth')).toEqual([])
  })

  test('does not inherit previous-month data on the first of the month', () => {
    const first = { ...dashboard, timeRange: presetWindow('thisMonth', new Date('2026-11-01')) }

    expect(rollingSnapshotHashes(first, panel, 'thisMonth')).toEqual([])
  })

  test('keeps static params and granularity isolated', () => {
    const hashes = rollingSnapshotHashes(dashboard, panel, 'thisMonth')

    expect(hashes).not.toContain(
      hash('thisMonth', '2026-10-08', { ...panel, staticParams: { currency: 'CNY' } }),
    )
    expect(hashes).not.toContain(hash('thisMonth', '2026-10-08', { ...panel, staticParams: {} }))
    const weekly = {
      ...dashboard,
      timeRange: { ...dashboard.timeRange, granularity: 'week' as const },
    }

    expect(rollingSnapshotHashes(weekly, panel, 'thisMonth')).not.toContain(hashes[0])
  })

  for (const preset of ['last7', 'last14', 'last30'] as const) {
    test(`${preset} only reuses earlier overlapping windows of the same length`, () => {
      const view = { ...dashboard, timeRange: presetWindow(preset, new Date('2026-10-09')) }
      const hashes = rollingSnapshotHashes(view, panel, preset)
      const days = Number(preset.slice(4))

      expect(hashes).toHaveLength(days - 1)
      expect(hashes[0]).toBe(hash(preset, '2026-10-08'))
      expect(hashes).not.toContain(hash(preset, '2026-08-01'))
      expect(hashes).not.toContain(hash('thisMonth', '2026-10-08'))
    })
  }
})
