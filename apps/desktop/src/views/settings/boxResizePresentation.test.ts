import assert from 'node:assert/strict'
import test from 'node:test'

import {
  boxCurrentSize,
  boxDiskHint,
  BOX_RESIZE_EFFECT,
  boxResizeRequest,
  canResize,
} from './boxResizePresentation.ts'

import type { AgentDevice, BoxSizeInfo } from '../../api/device-types'

const info: BoxSizeInfo = {
  vcpus: 2,
  memMiB: 4096,
  diskGiB: 20,
  running: true,
  sizes: [
    { vcpus: 2, memMiB: 4096 },
    { vcpus: 4, memMiB: 8192 },
  ],
  maxDiskGiB: 1024,
}

const box = (state: 'running' | 'paused' | 'creating', online = state === 'running') =>
  ({
    deviceId: 'box-1',
    label: 'Build box',
    platform: 'linux',
    online,
    box: { provider: 'instabox', sandboxId: 'sb', state },
  }) as AgentDevice

test('only what changes is sent, and nothing while nothing does', () => {
  assert.equal(boxResizeRequest(info, 2, 20), null)
  assert.deepEqual(boxResizeRequest(info, 4, 20), { vcpus: 4 })
  assert.deepEqual(boxResizeRequest(info, 2, 50), { diskGiB: 50 })
  assert.deepEqual(boxResizeRequest(info, 4, 50), { vcpus: 4, diskGiB: 50 })
})

test('the disk only grows, in whole GiB, up to what instabox makes; otherwise nothing is sent', () => {
  for (const disk of [10, 2048, 25.5, null]) assert.equal(boxResizeRequest(info, 4, disk), null)
  assert.deepEqual(boxResizeRequest(info, 2, 1024), { diskGiB: 1024 })
  assert.match(boxDiskHint(info), /only grows: from 20 up to 1024 GiB/)
})

test('a running Box is told it restarts; a paused one that it takes the size at its next start', () => {
  assert.equal(BOX_RESIZE_EFFECT.restart('Build box').confirmLabel, 'Resize and restart')
  assert.match(BOX_RESIZE_EFFECT.restart('Build box').note, /restarts.*every agent and process/)
  assert.equal(BOX_RESIZE_EFFECT.nextStart('Build box').confirmLabel, 'Resize')
  assert.match(BOX_RESIZE_EFFECT.nextStart('Build box').note, /next time it starts/)
  assert.equal(boxCurrentSize(info), 'Now 2 vCPU · 4 GiB, 20 GiB disk')
})

test('Resize is offered for a running or paused Box that is not already restarting', () => {
  assert.equal(canResize(box('running'), false), true)
  assert.equal(canResize(box('paused'), false), true)
  assert.equal(canResize(box('running'), true), false)
  assert.equal(canResize(box('creating'), false), false)
  // A host away from a running machine: wait for it rather than restart it from under it.
  assert.equal(canResize(box('running', false), false), false)
  assert.equal(canResize({ ...box('running'), box: undefined }, false), false)
})
