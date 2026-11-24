import { describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'

import { addComputerToVault } from './vault-computer'

import type { VaultComputerDeps } from './vault-computer'

// Run with: cd apps/backend && bun test src/lib/vault-computer.test.ts

const KEY = Buffer.alloc(32, 7).toString('base64')

function deps(overrides: Partial<VaultComputerDeps> = {}) {
  const calls = { commands: [] as string[], added: [] as unknown[] }
  const value: VaultComputerDeps = {
    computer: async (actorId) => {
      if (actorId !== 'aaaaaaaaaaaaaaaaaaaaaaaa')
        throw new AppError(403, 'device_manage_required', 'no')

      return { userId: 'owner', deviceId: 'box-1', label: 'Build box' }
    },
    run: async (_actor, _team, _device, command) => {
      calls.commands.push(command)

      return { status: 'ok', result: { stdout: `${KEY}\n`, stderr: '', exitCode: 0 } }
    },
    addVaultDevice: async (...args) => {
      calls.added.push(args)

      return { id: 'd1', name: 'Build box', publicKey: KEY, state: 'pending', createdAt: '' }
    },
    ...overrides,
  }

  return { value, calls }
}

const actor = 'aaaaaaaaaaaaaaaaaaaaaaaa'

describe('addComputerToVault', () => {
  test('the computer makes the key; only its public key is registered, linked to it', async () => {
    const { value, calls } = deps()

    expect(await addComputerToVault(actor, 't1', 'box-1', value)).toMatchObject({
      state: 'pending',
    })
    expect(calls.commands).toEqual([`nuphos vault keygen --user ${actor}`])
    expect(calls.added).toEqual([[actor, 'Build box', KEY, { userId: 'owner', deviceId: 'box-1' }]])
  })

  test('a long computer name is cut to what a vault device name holds', async () => {
    const { value, calls } = deps({
      computer: async () => ({ userId: 'owner', deviceId: 'box-1', label: `  ${'x'.repeat(80)}` }),
    })

    await addComputerToVault(actor, 't1', 'box-1', value)
    expect((calls.added[0] as string[])[1]).toBe('x'.repeat(64))
  })

  test('a blank computer name falls back to its device id', async () => {
    const { value, calls } = deps({
      computer: async () => ({ userId: 'owner', deviceId: 'box-1', label: '   ' }),
    })

    await addComputerToVault(actor, 't1', 'box-1', value)
    expect((calls.added[0] as string[])[1]).toBe('box-1')
  })

  test('a user id that could read as an option never reaches the shell', async () => {
    const { value, calls } = deps({
      computer: async () => ({ userId: 'owner', deviceId: 'box-1', label: 'Build box' }),
    })

    expect(await addComputerToVault('-rf', 't1', 'box-1', value).catch((e) => e.status)).toBe(400)
    expect(calls.commands).toEqual([])
  })

  test('nothing runs for someone who may not run commands there', async () => {
    const denied = deps()

    await expect(
      addComputerToVault('bbbbbbbbbbbbbbbbbbbbbbbb', 't1', 'box-1', denied.value),
    ).rejects.toMatchObject({ status: 403 })
    expect(denied.calls.commands).toEqual([])
  })

  test('an offline computer, an old CLI or a malformed key registers nothing', async () => {
    for (const run of [
      async () => ({ status: 'device_disconnected' as const }),
      async () => ({
        status: 'ok' as const,
        result: { stdout: '', stderr: 'unrecognized subcommand', exitCode: 2 },
      }),
      async () => ({
        status: 'ok' as const,
        result: { stdout: 'not a key', stderr: '', exitCode: 0 },
      }),
    ]) {
      const { value, calls } = deps({ run })

      expect(await addComputerToVault(actor, 't1', 'box-1', value).catch((e) => e.status)).toBe(409)
      expect(calls.added).toEqual([])
    }
  })
})
