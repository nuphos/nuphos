import assert from 'node:assert/strict'
import { test } from 'node:test'

import { providerPause } from './boxPresentation.ts'

import type { AgentDevice } from '../../api/device-types.ts'

const box = (deviceId: string, state: 'paused' | 'running', pausedBy?: string): AgentDevice => ({
  deviceId,
  label: deviceId,
  platform: 'linux',
  online: state === 'running',
  createdAt: new Date().toISOString(),
  box: { provider: 'instabox', sandboxId: `sb-${deviceId}`, state, ...(pausedBy && { pausedBy }) },
})

test('a Box its provider paused for host memory says so, and that it wakes on use', () => {
  const evicted = box('evicted', 'paused', 'memory_pressure')

  assert.equal(
    providerPause(evicted),
    'Paused by the provider (host out of memory). It resumes when you use it.',
  )
  // Paused by a person, or back running since: nothing to explain.
  assert.equal(providerPause(box('paused', 'paused')), undefined)
  assert.equal(providerPause({ ...evicted, box: { ...evicted.box!, state: 'running' } }), undefined)
})
