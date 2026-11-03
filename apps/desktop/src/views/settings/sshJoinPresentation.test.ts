import assert from 'node:assert/strict'
import { test } from 'node:test'

import { deviceSnapshot, joinedDevice } from './sshJoinPresentation.ts'

import type { AgentDevice } from '../../api/device-types.ts'

const device = (deviceId: string, online: boolean) =>
  ({ deviceId, label: deviceId, platform: 'linux', online }) as AgentDevice

test('the joined computer is a new one online, or one that came back online', () => {
  const before = deviceSnapshot([device('a', true), device('b', false)])

  assert.equal(joinedDevice(before, [device('a', true), device('b', false)]), undefined)
  assert.equal(joinedDevice(before, [device('a', true), device('c', false)]), undefined)
  assert.equal(joinedDevice(before, [device('a', true), device('c', true)])?.deviceId, 'c')
  assert.equal(joinedDevice(before, [device('a', true), device('b', true)])?.deviceId, 'b')
})
