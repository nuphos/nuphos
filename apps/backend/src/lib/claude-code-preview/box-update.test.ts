import { describe, expect, test } from 'bun:test'

import { localRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { BOX_INSTALL_COMMAND, BOX_UPDATE_COMMAND } from '@/lib/agent/devices/box-instabox-client'

import { boxUpdateStatus, requestBoxUpdate } from './box-update'

import type { BoxUpdateDeps } from './box-update'
import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'

// Run with: cd apps/backend && bun test src/lib/claude-code-preview/box-update.test.ts

const claude = localRuntimeId({ userId: 'u1', deviceId: 'box-1', provider: 'claude-code' })
const codex = localRuntimeId({ userId: 'u1', deviceId: 'box-1', provider: 'codex' })
const status = (cliVersion?: string) =>
  ({
    agents: { 'claude-code': {}, codex: {} },
    ...(cliVersion ? { cliVersion } : {}),
  }) as unknown as LocalRuntimeStatus

function deps(overrides: Partial<BoxUpdateDeps> = {}) {
  const calls = { updated: 0, asked: [] as string[] }
  const value: BoxUpdateDeps = {
    isBox: async () => true,
    canManage: async (actorId) => actorId === 'admin',
    status: async () => status('0.4.0'),
    latestVersion: async () => ({ version: '0.5.0', url: 'https://example.test/cli-v0.5.0' }),
    busy: async (_team, id, actorId) => {
      calls.asked.push(`${actorId}:${id}`)

      return false
    },
    update: async () => {
      calls.updated++
    },
    ...overrides,
  }

  return { value, calls }
}

describe('Box update', () => {
  test('a Box agent compares the CLI its host reports with the newest CLI release', async () => {
    expect(await boxUpdateStatus(claude, deps().value)).toEqual({
      state: 'available',
      currentVersion: '0.4.0',
      latestVersion: '0.5.0',
      releaseUrl: 'https://example.test/cli-v0.5.0',
    })
    const current = deps({ status: async () => status('0.5.0') }).value

    expect((await boxUpdateStatus(claude, current))?.state).toBe('current')
    // An older host that does not report its CLI cannot be compared.
    const old = deps({ status: async () => status() }).value

    expect((await boxUpdateStatus(claude, old))?.state).toBe('unknown')
    // Not a Box, or a Box that is away: no update to show.
    expect(await boxUpdateStatus(claude, deps({ isBox: async () => false }).value)).toBeUndefined()
    expect(
      await boxUpdateStatus(claude, deps({ status: async () => undefined }).value),
    ).toBeUndefined()
  })

  test('updating restarts the host only when none of its agents is mid-turn', async () => {
    const idle = deps()

    expect(await requestBoxUpdate('t1', codex, 'admin', idle.value)).toEqual({ version: '0.5.0' })
    expect(idle.calls.updated).toBe(1)
    // Every agent the host runs is asked, as the administrator, not only the one whose card was used.
    expect(idle.calls.asked).toEqual([`admin:${claude}`, `admin:${codex}`])

    const busy = deps({ busy: async (_team, id) => id === codex })

    await expect(requestBoxUpdate('t1', claude, 'admin', busy.value)).rejects.toMatchObject({
      status: 409,
      code: 'runtime_busy',
      message: 'Updates wait for active conversations to finish.',
    })
    expect(busy.calls.updated).toBe(0)
  })

  test('an update is refused for a personal computer, another team’s Box, an away Box, or no known release', async () => {
    const refused = async (overrides: Partial<BoxUpdateDeps>, actorId = 'admin') => {
      const attempt = deps(overrides)

      await requestBoxUpdate('t1', claude, actorId, attempt.value).catch((error: unknown) => {
        expect(attempt.calls.updated).toBe(0)
        throw error
      })
    }

    await expect(refused({ isBox: async () => false })).rejects.toMatchObject({
      status: 409,
      code: 'runtime_not_managed',
    })
    // Not an administrator of this Box's team (or another team's Box): not found.
    await expect(refused({}, 'someone-else')).rejects.toMatchObject({
      status: 404,
      code: 'device_not_found',
    })
    await expect(refused({ status: async () => undefined })).rejects.toMatchObject({
      code: 'runtime_offline',
    })
    await expect(refused({ latestVersion: async () => null })).rejects.toMatchObject({
      code: 'runtime_release_unavailable',
    })
  })

  test('the update installs the newest CLI, drops generated panels and always restarts the host', () => {
    // One install step for create and update: it always fetches the newest CLI.
    expect(BOX_INSTALL_COMMAND).toContain('curl -fsSL https://nuphos.ai/install | sh')
    expect(BOX_INSTALL_COMMAND).not.toContain('command -v nuphos')
    const lines = BOX_UPDATE_COMMAND.split('\n')

    // The host is stopped first, killed if it hangs, and started last, even when the install fails.
    expect(lines[0]).toContain('pkill -f "[h]ost.mjs"')
    expect(lines[1]).toBe('pkill -9 -f "[h]ost.mjs"')
    expect(lines.at(-1)).toContain('nuphos agent')
    expect(BOX_UPDATE_COMMAND).toContain(`(\n${BOX_INSTALL_COMMAND}`)
    // Only session panels without the browser launcher are dropped.
    expect(BOX_UPDATE_COMMAND).toContain('grep -L web-browser.desktop')
  })
})
