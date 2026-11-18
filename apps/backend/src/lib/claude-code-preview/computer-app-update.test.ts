import { describe, expect, test } from 'bun:test'

import { requestComputerAppUpdate, setComputerAutoInstall } from './computer-app-update'

import type { ComputerAppUpdateDeps, ComputerAutoInstallDeps } from './computer-app-update'
import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'

const staged: LocalRuntimeStatus = {
  agents: {},
  app: { version: '0.120.0', update: { version: '0.121.0', ready: true } },
}

function deps(over: Partial<ComputerAppUpdateDeps> = {}) {
  const sent: unknown[] = []
  const value: ComputerAppUpdateDeps = {
    // Only owner's own Mac: computers are looked up under the caller.
    isDesktop: async (userId, deviceId) => userId === 'owner' && deviceId === 'mac',
    status: async () => staged,
    update: async (target) => {
      sent.push(target)
    },
    ...over,
  }

  return { value, sent }
}

describe('requestComputerAppUpdate', () => {
  test("asks the owner's computer to restart into its staged update", async () => {
    const { value, sent } = deps()

    expect(await requestComputerAppUpdate('team', 'owner', 'mac', value)).toEqual({
      version: '0.121.0',
    })
    expect(sent).toEqual([{ userId: 'owner', actorId: 'owner', deviceId: 'mac', teamId: 'team' }])
  })

  test('another person, even a team admin, cannot update it', async () => {
    const { value, sent } = deps()

    await expect(requestComputerAppUpdate('team', 'admin', 'mac', value)).rejects.toMatchObject({
      status: 404,
    })
    expect(sent).toEqual([])
  })

  test('refuses an offline computer, and one still downloading or up to date', async () => {
    for (const status of [
      undefined,
      { agents: {}, app: { version: '0.120.0', update: { version: '0.121.0', ready: false } } },
      { agents: {}, app: { version: '0.120.0' } },
      { agents: {} },
    ]) {
      const { value, sent } = deps({ status: async () => status })

      await expect(requestComputerAppUpdate('team', 'owner', 'mac', value)).rejects.toMatchObject({
        status: 409,
      })
      expect(sent).toEqual([])
    }
  })
})

describe('computer automatic updates', () => {
  function autoDeps(over: Partial<ComputerAutoInstallDeps> = {}) {
    const sent: unknown[] = []
    const value: ComputerAutoInstallDeps = {
      // Only someone who manages box-1; its host reports under its transport owner.
      manage: async (actorId, _teamId, deviceId) => {
        if (actorId !== 'admin' || deviceId !== 'box-1') throw new Error('not found')

        return { userId: 'transport' }
      },
      online: async () => true,
      set: async (target, enabled) => {
        sent.push([target, enabled])

        return { enabled }
      },
      ...over,
    }

    return { value, sent }
  }

  test('whoever manages a computer turns its automatic updates off, on the computer', async () => {
    const { value, sent } = autoDeps()

    expect(await setComputerAutoInstall('t1', 'admin', 'box-1', false, value)).toEqual({
      enabled: false,
    })
    expect(sent).toEqual([
      [{ userId: 'transport', actorId: 'admin', deviceId: 'box-1', teamId: 't1' }, false],
    ])
  })

  test('nobody else can, and an offline computer is refused', async () => {
    const { value, sent } = autoDeps()

    await expect(setComputerAutoInstall('t1', 'member', 'box-1', false, value)).rejects.toThrow()
    await expect(
      setComputerAutoInstall('t1', 'admin', 'box-1', false, {
        ...value,
        online: async () => false,
      }),
    ).rejects.toMatchObject({ code: 'runtime_offline' })
    expect(sent).toEqual([])
  })
})
