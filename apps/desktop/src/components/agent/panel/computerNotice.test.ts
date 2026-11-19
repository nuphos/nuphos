import assert from 'node:assert/strict'
import { test } from 'node:test'

import { computerNotice } from './computerNotice.ts'

import type { AgentDevice } from '../../../api/device-types'

const GB = 1024 ** 3

function fullComputer(access: AgentDevice['access']) {
  return {
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

test('the disk banner shows only to people who can free space on the computer', () => {
  const banner = { kind: 'disk', label: 'Studio Mac', percent: 96 }

  assert.deepEqual(computerNotice(fullComputer('owner')), banner)
  assert.deepEqual(computerNotice(fullComputer('manage')), banner)
  assert.deepEqual(computerNotice(fullComputer(undefined)), banner)
  assert.equal(computerNotice(fullComputer('use')), null)
})

test('an outdated computer is said to everyone, as before', () => {
  assert.deepEqual(computerNotice({ ...fullComputer('use'), outdated: 'desktop' }), {
    kind: 'outdated',
    label: 'Studio Mac',
  })
})
