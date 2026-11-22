import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

import { computerNotice } from './computerNotice.ts'
import { dismissDisk } from './diskSnooze.ts'

import type { AgentDevice } from '../../../api/device-types'

const GB = 1024 ** 3

function fullComputer(access: AgentDevice['access']) {
  return {
    deviceId: 'd1',
    label: 'Studio Mac',
    access,
    metricsStatus: 'live' as const,
    metrics: {
      sampledAt: '2026-11-18T00:00:00Z',
      cpuPercent: 10,
      memory: { used: 8 * GB, total: 32 * GB },
      disk: { used: 480 * GB, total: 500 * GB },
    },
  }
}

function noStore() {
  const items = new Map<string, string>()

  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  } as unknown as Storage
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', { value: noStore(), configurable: true })
})

test('the disk banner shows only to people who can free space on the computer', () => {
  const banner = { kind: 'disk', label: 'Studio Mac', percent: 96, deviceId: 'd1' }

  assert.deepEqual(computerNotice(fullComputer('owner')), banner)
  assert.deepEqual(computerNotice(fullComputer('manage')), banner)
  assert.deepEqual(computerNotice(fullComputer(undefined)), banner)
  assert.equal(computerNotice(fullComputer('use')), null)
})

test('a disk warning put away stays away until it means something new', () => {
  dismissDisk('d1', 96)
  assert.equal(computerNotice(fullComputer('owner')), null)
  // Another computer was not dismissed, and an outdated Nuphos still fails the turn.
  assert.deepEqual(computerNotice({ ...fullComputer('owner'), deviceId: 'd2' }), {
    kind: 'disk',
    label: 'Studio Mac',
    percent: 96,
    deviceId: 'd2',
  })
  assert.deepEqual(computerNotice({ ...fullComputer('owner'), outdated: 'desktop' }), {
    kind: 'outdated',
    label: 'Studio Mac',
  })
})

test('an outdated computer is said to everyone, as before', () => {
  assert.deepEqual(computerNotice({ ...fullComputer('use'), outdated: 'desktop' }), {
    kind: 'outdated',
    label: 'Studio Mac',
  })
})
