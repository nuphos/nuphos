import assert from 'node:assert/strict'
import { test } from 'node:test'

import { blockedStart, boxRows } from './billingPresentation.ts'

import type { AgentDevice, BoxUsage } from '../../api/device-types.ts'

const usage = (boxes: BoxUsage['boxes'], usedVcpus: number): BoxUsage => ({
  limitVcpus: 12,
  subscribed: true,
  usedVcpus,
  boxVcpus: 4,
  boxes,
  billingUrl: null,
})
const device = (label: string, sandboxId: string) =>
  ({
    deviceId: label,
    label,
    platform: 'linux',
    box: { provider: 'instabox', sandboxId, state: 'running' },
  }) as AgentDevice

test('own Boxes by name and size, teammates running Boxes as one row', () => {
  const rows = boxRows(
    usage(
      [
        { sandboxId: 'a', vcpus: 2, running: true },
        { sandboxId: 'b', vcpus: 8, running: false },
        { sandboxId: 'c', vcpus: 4, running: true },
        { sandboxId: 'd', vcpus: 3, running: true },
        { sandboxId: 'e', vcpus: 8, running: false },
      ],
      9,
    ),
    [device('Box 1', 'a'), device('Build box', 'b')],
  )

  assert.deepEqual(
    rows.map(({ name, vcpus, running }) => [name, vcpus, running]),
    [
      ['Box 1', 2, true],
      ['Build box', 8, false],
      ["Teammates' Boxes", 7, true],
    ],
  )
})

test('a paused Box that does not fit names itself, else a new Box, else nothing', () => {
  const rows = boxRows(usage([{ sandboxId: 'b', vcpus: 8, running: false }], 9), [
    device('Build box', 'b'),
  ])

  assert.equal(blockedStart(usage([], 9), rows), 'Starting Build box needs 8 vCPU; 3 free.')
  assert.equal(blockedStart(usage([], 9), []), 'A new Box needs 4 vCPU; 3 free.')
  assert.equal(blockedStart(usage([], 2), []), null)
})
