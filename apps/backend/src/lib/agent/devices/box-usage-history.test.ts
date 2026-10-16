import { describe, expect, test } from 'bun:test'

import { noteBoxPresence, sampleId, stepSeries } from './box-usage-history'

import type { AgentDevice } from './store'

const from = Date.parse('2026-10-16T00:00:00Z')
const to = Date.parse('2026-10-16T01:00:00Z')
const at = (iso: string) => new Date(`2026-10-16T${iso}Z`)

describe('Box usage history', () => {
  test('changes in the same minute share one sample', () => {
    expect(sampleId('t1', at('00:05:01'))).toBe(sampleId('t1', at('00:05:59')))
    expect(sampleId('t1', at('00:05:59'))).not.toBe(sampleId('t1', at('00:06:00')))
    expect(sampleId('t1', at('00:05:01'))).not.toBe(sampleId('t2', at('00:05:01')))
  })

  test('the window starts with the reading in force before it', () => {
    const points = stepSeries(
      { usedVcpus: 4, limitVcpus: 8 },
      [],
      { from, to, bucketMinutes: 10 },
      null,
    )

    expect(points).toEqual([
      { at: '2026-10-16T00:00:00.000Z', usedVcpus: 4, limitVcpus: 8 },
      { at: '2026-10-16T01:00:00.000Z', usedVcpus: 4, limitVcpus: 8 },
    ])
  })

  test('a bucket keeps its peak use and last limit, and now is read live', () => {
    const points = stepSeries(
      null,
      [
        { at: at('00:12:00'), usedVcpus: 2, limitVcpus: 8 },
        { at: at('00:14:00'), usedVcpus: 6, limitVcpus: 8 },
        { at: at('00:18:00'), usedVcpus: 0, limitVcpus: 16 },
        { at: at('00:31:00'), usedVcpus: 4, limitVcpus: 16 },
      ],
      { from, to, bucketMinutes: 10 },
      { usedVcpus: 2, limitVcpus: 16 },
    )

    expect(points).toEqual([
      { at: '2026-10-16T00:10:00.000Z', usedVcpus: 6, limitVcpus: 16 },
      { at: '2026-10-16T00:30:00.000Z', usedVcpus: 4, limitVcpus: 16 },
      { at: '2026-10-16T01:00:00.000Z', usedVcpus: 2, limitVcpus: 16 },
    ])
  })

  test('no samples and no live reading is an empty series', () => {
    expect(stepSeries(null, [], { from, to, bucketMinutes: 10 }, null)).toEqual([])
  })

  test('only a Box tunnel records its team', async () => {
    const noted: string[] = []
    const devices: Record<string, Partial<AgentDevice>> = {
      box: { deviceId: 'box', box: { provider: 'instabox', teamId: 't1', createdBy: 'u1' } },
      laptop: { deviceId: 'laptop' },
    }
    const getDevice = (_userId: string, deviceId: string) =>
      Promise.resolve((devices[deviceId] as AgentDevice | undefined) ?? null)

    for (const id of ['box', 'laptop', 'missing'])
      await noteBoxPresence('u1', id, getDevice, (teamId) => noted.push(teamId))

    expect(noted).toEqual(['t1'])
  })
})
