import { expect, test } from 'bun:test'

import { requireAgentSignInAccess, requireShellAccess, shellAllowed } from './manage-access'

import type { DeviceAccessDeps } from './box-access'
import type { AgentDevice } from './store'

function box(useTerminal?: boolean): AgentDevice {
  return {
    userId: 'host',
    deviceId: 'box',
    label: 'Box',
    platform: 'linux',
    allowLocalExec: true,
    box: { provider: 'instabox', teamId: 't1', createdBy: 'owner', useTerminal },
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

test('commands take managing the computer; a terminal opens for users only when its owner lets them', () => {
  for (const useTerminal of [undefined, false, true]) {
    const device = box(useTerminal)

    for (const actor of ['owner', 'manager']) {
      expect(shellAllowed(device, actor, 't1', 'exec')).toBe(true)
      expect(shellAllowed(device, actor, 't1', 'terminal')).toBe(true)
    }
    expect(shellAllowed(device, 'user', 't1', 'exec')).toBe(false)
    expect(shellAllowed(device, 'user', 't1', 'terminal')).toBe(useTerminal === true)
    expect(shellAllowed(device, 'stranger', 't1', 'terminal')).toBe(false)
    expect(shellAllowed(device, 'user', 't2', 'terminal')).toBe(false)
  }
})

test('one who only uses the computer is told why; one who cannot use it does not learn it exists', async () => {
  const device = box()

  await expect(
    requireShellAccess('user', 't1', 'box', 'terminal', deps(device)),
  ).rejects.toMatchObject({ status: 403, code: 'device_manage_required' })
  await expect(
    requireShellAccess('stranger', 't1', 'box', 'exec', deps(device)),
  ).rejects.toMatchObject({ status: 404 })
  expect((await requireShellAccess('manager', 't1', 'box', 'exec', deps(device))).deviceId).toBe(
    'box',
  )
  expect((await requireShellAccess('user', 't1', 'box', 'terminal', deps(box(true)))).userId).toBe(
    'host',
  )
})

test('only those who manage the computer sign its agents in or out, whatever the terminal setting', async () => {
  const device = box(true)

  await expect(requireAgentSignInAccess('user', 't1', 'box', deps(device))).rejects.toMatchObject({
    status: 403,
  })
  for (const actor of ['owner', 'manager'])
    expect((await requireAgentSignInAccess(actor, 't1', 'box', deps(device))).deviceId).toBe('box')
})
