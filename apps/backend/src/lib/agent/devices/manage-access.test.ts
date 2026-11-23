import { expect, test } from 'bun:test'

import { requireAgentSignInAccess, requireShellAccess } from './manage-access'

import type { DeviceAccessDeps } from './box-access'
import type { AgentDevice } from './store'

function box(): AgentDevice {
  return {
    userId: 'host',
    deviceId: 'box',
    label: 'Box',
    platform: 'linux',
    allowLocalExec: true,
    box: { provider: 'instabox', teamId: 't1', createdBy: 'owner' },
    access: [
      { teamId: 't1', everyone: false, userIds: ['user', 'manager'], managerIds: ['manager'] },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function deps(device: AgentDevice): DeviceAccessDeps {
  return {
    getDevice: () => Promise.resolve(null),
    listDevices: () => Promise.resolve([]),
    listBoxes: () => Promise.resolve([device]),
    listGranted: () => Promise.resolve([]),
    findGranted: () => Promise.resolve([]),
    role: () => Promise.resolve('EDITOR'),
  }
}

test('commands and a terminal take managing the computer; one who only uses it is told why', async () => {
  // A record saved while an owner could let users open a terminal still grants nothing more.
  const legacy = { ...box(), box: { ...box().box!, useTerminal: true } } as AgentDevice

  for (const device of [box(), legacy])
    for (const purpose of ['exec', 'terminal'] as const) {
      for (const actor of ['owner', 'manager'])
        expect((await requireShellAccess(actor, 't1', 'box', purpose, deps(device))).deviceId).toBe(
          'box',
        )
      await expect(
        requireShellAccess('user', 't1', 'box', purpose, deps(device)),
      ).rejects.toMatchObject({ status: 403, code: 'device_manage_required' })
      await expect(
        requireShellAccess('stranger', 't1', 'box', purpose, deps(device)),
      ).rejects.toMatchObject({ status: 404 })
    }
})

test('only those who manage the computer sign its agents in or out', async () => {
  const device = box()

  await expect(requireAgentSignInAccess('user', 't1', 'box', deps(device))).rejects.toMatchObject({
    status: 403,
  })
  for (const actor of ['owner', 'manager'])
    expect((await requireAgentSignInAccess(actor, 't1', 'box', deps(device))).deviceId).toBe('box')
})
