import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentDeviceAudit } from '@/lib/test/doubles/agent-devices-audit'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useAgentDeviceUpload } from '@/lib/test/doubles/agent-devices-upload'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { AgentConversation } from '@/lib/agent/db'
import type { DeviceExecAuditInput } from '@/lib/agent/devices/audit'
import type { TeamMembership } from '@/lib/identity/types'

const teamId = '123456789012345678901234'
const turn = {
  userId: 'participant',
  conversationOwnerUserId: 'owner',
  teamId,
  sessionId: 'session',
  origin: 'user' as const,
}
let calls = 0
let member = true
let sendable = true
let fail = false
let audits: DeviceExecAuditInput[] = []

useAgentDeviceStore({ isActiveTeamMember: async () => member })
useAgentDeviceAudit({
  recordDeviceExecAudit: async (input) => {
    audits.push(input)
  },
})
useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'EDITOR' } as TeamMembership) })
useAgentDb({
  getConversationBySessionId: () =>
    Promise.resolve(
      sendable
        ? ({
            sessionId: 'session',
            userId: 'owner',
            teamId,
            participantIds: ['participant'],
          } as AgentConversation)
        : null,
    ),
})
useAgentDeviceUpload({
  dispatchLocalUpload: async (actor, device, path, scope) => {
    calls++
    expect(actor).toBe('owner')
    expect(device).toBe('selected')
    expect(path).toBe('/fixture.bin')
    expect(scope.userId).toBe('owner')
    expect(scope.sessionId).toBe('session')
    if (fail) throw new Error('https://fixture.invalid/?signed=must-not-leak')

    return { groupId: 'group', fileName: 'fixture.bin', size: 12 }
  },
})

const { createLocalUploadTool } = await import('./local-upload')
const tool = () =>
  createLocalUploadTool(
    [{ deviceId: 'selected', ownerUserId: 'computer-owner', label: 'Computer' }],
    turn,
  )

beforeEach(() => {
  calls = 0
  audits = []
  member = true
  sendable = true
  fail = false
})

test('only selected computers are dispatched and shared attribution stays distinct', async () => {
  expect(
    await tool().execute({ label: 'upload', path: '/fixture.bin', device: 'unselected' }, {}),
  ).toHaveProperty('error')
  expect(calls).toBe(0)
  expect(await tool().execute({ label: 'upload', path: '/fixture.bin' }, {})).toEqual({
    groupId: 'group',
    fileName: 'fixture.bin',
    size: 12,
  })
  expect(audits).toHaveLength(2)
  expect(audits[1]).toMatchObject({
    actorUserId: 'participant',
    ownerUserId: 'computer-owner',
    conversationOwnerUserId: 'owner',
    outcome: 'ok',
  })
})

test('membership and conversation access are rechecked before dispatch', async () => {
  member = false
  expect(await tool().execute({ label: 'upload', path: '/fixture.bin' }, {})).toHaveProperty(
    'error',
  )
  member = true
  sendable = false
  expect(await tool().execute({ label: 'upload', path: '/fixture.bin' }, {})).toHaveProperty(
    'error',
  )
  expect(calls).toBe(0)
})

test('raw exceptions never enter tool output or device audit records', async () => {
  fail = true
  const result = await tool().execute({ label: 'upload', path: '/fixture.bin' }, {})

  expect(result).toEqual({ error: 'upload_failed' })
  expect(JSON.stringify(audits)).not.toContain('signed')
  expect(audits.at(-1)?.outcome).toBe('error')
})
