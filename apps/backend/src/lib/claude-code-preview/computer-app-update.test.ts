import { describe, expect, test } from 'bun:test'

import { requestComputerAppUpdate } from './computer-app-update'

import type { ComputerAppUpdateDeps } from './computer-app-update'
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
