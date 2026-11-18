import { expect, test } from 'bun:test'

import type { AgentDevice } from '@/lib/agent/devices/store'

import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'

const mac = {
  userId: 'bryan',
  deviceId: 'mac-1',
  label: 'Mac',
  platform: 'darwin',
  allowLocalExec: true,
  access: [{ teamId: 'team-1', everyone: true, userIds: [], managerIds: ['dana'] }],
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as AgentDevice

useAgentDeviceStore({
  getAgentDevice: async (userId: string, deviceId: string) =>
    userId === 'bryan' && deviceId === 'mac-1' ? mac : null,
})

const { computerSigners } = await import('./sign-in-signers')

test("a computer's owner and managers sign its agent in; those who only use it do not", async () => {
  const signers = await computerSigners('team-1', 'local_bryan_mac-1')

  expect(signers?.owner).toBe('bryan')
  expect(['bryan', 'dana', 'shant'].map((id) => signers?.canSignIn(id))).toEqual([
    true,
    true,
    false,
  ])
})

test('managing it in another team counts for nothing here', async () => {
  expect((await computerSigners('team-2', 'local_bryan_mac-1'))?.canSignIn('dana')).toBe(false)
})

test('a team agent, or a computer no longer on record, has no computer to ask about', async () => {
  expect(await computerSigners('team-1', 'managed-1')).toBeNull()
  expect(await computerSigners('team-1', 'local_bryan_gone-1')).toBeNull()
})
