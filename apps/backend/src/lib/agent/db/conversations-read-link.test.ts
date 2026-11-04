import { beforeEach, expect, test } from 'bun:test'

import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type { AgentDevice } from '@/lib/agent/devices/store'
import type * as dbActual from '@/lib/db'

const TEAM = 'team'
const mac = {
  userId: 'owner',
  deviceId: 'mac',
  label: 'Mac',
  createdAt: new Date(0),
  access: [{ teamId: TEAM, everyone: false, userIds: ['user'], managerIds: [] }],
} as unknown as AgentDevice
let memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
useAgentDeviceStore({
  getAgentDevice: async (owner, id) => (owner === 'owner' && id === 'mac' ? mac : null),
  findGrantedDevices: async (_team, id) => (id === 'mac' ? [mac] : []),
  listTeamBoxes: async () => [],
})
useIdentity({ getTeamMembership: (async () => ({ role: 'EDITOR' })) as never })

const { getReadableConversation } = await import('./conversations')

beforeEach(() => {
  memory = portabilityDb()
  memory.rows('agent_conversations').push(
    {
      sessionId: 'on-mac',
      userId: 'owner',
      teamId: TEAM,
      generalAccess: 'none',
      runtimeId: 'local_owner_mac',
    },
    { sessionId: 'managed', userId: 'owner', teamId: TEAM, generalAccess: 'none' },
  )
})

test('whoever may use the computer opens a conversation by link, shared or not', async () => {
  expect(await getReadableConversation('on-mac', 'user', TEAM)).toMatchObject({
    sessionId: 'on-mac',
  })
  expect(await getReadableConversation('on-mac', 'stranger', TEAM)).toBeNull()
})

test('a conversation on no one’s computer opens only to whom it is shared with', async () => {
  expect(await getReadableConversation('managed', 'user', TEAM)).toBeNull()
})

test('without a team only the owner reads', async () => {
  expect(await getReadableConversation('on-mac', 'user')).toBeNull()
})
