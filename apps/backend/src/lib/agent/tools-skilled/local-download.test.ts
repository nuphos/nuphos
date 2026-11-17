import { beforeEach, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentDeviceAudit } from '@/lib/test/doubles/agent-devices-audit'
import { useAgentDeviceDownload } from '@/lib/test/doubles/agent-devices-download'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { AgentConversation } from '@/lib/agent/db'
import type { DeviceExecAuditInput } from '@/lib/agent/devices/audit'
import type { TeamMembership } from '@/lib/identity/types'

const teamId = '123456789012345678901234'
let calls = 0
let member = true
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
    Promise.resolve({
      sessionId: 'session',
      userId: 'owner',
      teamId,
      participantIds: ['participant'],
    } as AgentConversation),
})
useAgentDeviceDownload({
  dispatchLocalDownload: async (actor, device, request, scope) => {
    calls++
    expect(actor).toBe('owner')
    expect(device).toBe('selected')
    expect(request).toEqual({ groupId: 'group', path: '/deck.html', overwrite: true })
    expect(scope.sessionId).toBe('session')
    if (fail) throw new Error('https://fixture.invalid/?signed=must-not-leak')

    return { path: '/deck.html', size: 12 }
  },
})

const { createLocalDownloadTool } = await import('./local-download')
const tool = () =>
  createLocalDownloadTool(
    [{ deviceId: 'selected', ownerUserId: 'computer-owner', label: 'Computer' }],
    {
      userId: 'participant',
      conversationOwnerUserId: 'owner',
      teamId,
      sessionId: 'session',
      origin: 'user',
    },
  )
const input = { label: 'save', groupId: 'group', path: '/deck.html', overwrite: true }

beforeEach(() => {
  calls = 0
  audits = []
  member = true
  fail = false
})

test('saves through a selected computer for the conversation owner, audited', async () => {
  expect(await tool().execute({ ...input, device: 'unselected' }, {})).toHaveProperty('error')
  member = false
  expect(await tool().execute(input, {})).toHaveProperty('error')
  expect(calls).toBe(0)
  member = true
  expect(await tool().execute(input, {})).toEqual({ path: '/deck.html', size: 12 })
  expect(audits.at(-1)).toMatchObject({
    actorUserId: 'participant',
    ownerUserId: 'computer-owner',
    command: 'local_download "/deck.html"',
    outcome: 'ok',
  })
})

test('raw exceptions never enter tool output or device audit records', async () => {
  fail = true
  expect(await tool().execute(input, {})).toEqual({ error: 'download_failed' })
  expect(JSON.stringify(audits)).not.toContain('signed')
  expect(audits.at(-1)?.outcome).toBe('error')
})
