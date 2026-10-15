import { beforeEach, describe, expect, test } from 'bun:test'

import { localRuntimeId, parseLocalRuntimeUrl } from '@/lib/agent/devices/local-runtime/address'

import { listOwnLocalRuntimes, resolveLocalRuntimeEndpoint } from './local-runtime-catalog'

import type { LocalRuntimeCatalogDeps } from './local-runtime-catalog'
import type { LocalRuntimePresence } from '@/lib/agent/devices/local-runtime/presence'
import type { AgentDevice } from '@/lib/agent/devices/store'

const ref = { userId: 'owner', deviceId: 'mac-1', provider: 'claude-code' as const }
const runtimeId = localRuntimeId(ref)

let teams: Set<string>
let presence: LocalRuntimePresence | null

function device(userId: string, deviceId: string, label: string): AgentDevice {
  return {
    userId,
    deviceId,
    label,
    platform: 'darwin',
    allowLocalExec: false,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  }
}

const deps: LocalRuntimeCatalogDeps = {
  access: {
    getDevice: async (owner, id) =>
      owner === 'owner' && id === 'mac-1' ? device(owner, id, 'Olivia’s MacBook') : null,
    listDevices: async (owner) =>
      owner === 'owner' ? [device(owner, 'mac-1', 'Olivia’s MacBook')] : [],
    listBoxes: async () => [],
    role: async (actor, team) => (teams.has(`${actor}:${team}`) ? 'EDITOR' : null),
  },
  isMember: async (userId, teamId) => teams.has(`${userId}:${teamId}`),
  getPresence: async () => presence,
  wakeDevice: () => Promise.resolve(undefined),
}

function online(loggedIn: boolean | null = true, codex = false): LocalRuntimePresence {
  const agent = { cli: { installed: true, loggedIn } }

  return {
    conn: 'c1',
    seenAt: Date.now(),
    status: {
      agents: { 'claude-code': agent, ...(codex ? { codex: agent } : {}) },
      backendUrl: 'http://127.0.0.1:4000',
    },
  }
}

beforeEach(() => {
  teams = new Set(['owner:t1', 'teammate:t1'])
  presence = online()
})

describe('local runtime catalog', () => {
  test('the owner sees their computer in any team they belong to', async () => {
    const [listed] = await listOwnLocalRuntimes('t1', 'owner', deps)

    expect(listed).toMatchObject({
      id: runtimeId,
      kind: 'local',
      label: 'Claude Code in Olivia’s MacBook',
      local: { ownerUserId: 'owner', deviceId: 'mac-1', signedIn: true },
    })
    expect(await listOwnLocalRuntimes('t2', 'owner', deps)).toEqual([])
  })

  test('a teammate never sees another member’s local agent', async () => {
    expect(await listOwnLocalRuntimes('t1', 'teammate', deps)).toEqual([])
  })

  test('a teammate cannot run the owner’s local agent, even in a shared team', async () => {
    await expect(
      resolveLocalRuntimeEndpoint('t1', runtimeId, 'teammate', 'transport', deps),
    ).rejects.toMatchObject({ status: 404, code: 'runtime_not_found' })
    await expect(
      resolveLocalRuntimeEndpoint('t1', runtimeId, 'teammate', 'control', deps),
    ).rejects.toMatchObject({ status: 404, code: 'runtime_not_found' })
  })

  test('resolves a tunnel address scoped to the team and purpose for the owner', async () => {
    const endpoint = await resolveLocalRuntimeEndpoint('t1', runtimeId, 'owner', 'control', deps)

    expect(endpoint).toMatchObject({
      runtimeId,
      authKey: 'control',
      external: true,
      local: { userId: ref.userId, deviceId: ref.deviceId },
      backendUrl: 'http://127.0.0.1:4000',
    })
    expect(parseLocalRuntimeUrl(endpoint.url)).toEqual({
      ...ref,
      teamId: 't1',
      actorId: ref.userId,
    })
  })

  test('each agent the computer runs is its own option with its own provider', async () => {
    presence = online(true, true)
    const listed = await listOwnLocalRuntimes('t1', 'owner', deps)

    expect(listed.map((instance) => [instance.label, instance.provider])).toEqual([
      ['Claude Code in Olivia’s MacBook', 'claude-code'],
      ['Codex in Olivia’s MacBook', 'codex'],
    ])
    const codex = await resolveLocalRuntimeEndpoint(
      't1',
      listed[1]?.id ?? '',
      'owner',
      'transport',
      deps,
    )

    expect(codex.provider).toBe('codex')
    expect(parseLocalRuntimeUrl(codex.url)).toMatchObject({ provider: 'codex' })
  })

  test('an agent the computer is not running is offline even while its tunnel is up', async () => {
    const codexId = localRuntimeId({ ...ref, provider: 'codex' })

    await expect(
      resolveLocalRuntimeEndpoint('t1', codexId, 'owner', 'transport', deps),
    ).rejects.toMatchObject({ code: 'runtime_offline' })
  })

  test('a team the owner is not in, or has left, is refused at the next request', async () => {
    await expect(
      resolveLocalRuntimeEndpoint('t2', runtimeId, 'owner', 'transport', deps),
    ).rejects.toMatchObject({ code: 'runtime_not_found' })
    teams.clear()
    expect(await listOwnLocalRuntimes('t1', 'owner', deps)).toEqual([])
    await expect(
      resolveLocalRuntimeEndpoint('t1', runtimeId, 'owner', 'transport', deps),
    ).rejects.toMatchObject({ code: 'runtime_not_found' })
  })

  test('a computer without a connected tunnel is not offered and refuses turns', async () => {
    presence = null

    expect(await listOwnLocalRuntimes('t1', 'owner', deps)).toEqual([])
    await expect(
      resolveLocalRuntimeEndpoint('t1', runtimeId, 'owner', 'transport', deps),
    ).rejects.toMatchObject({ code: 'runtime_offline' })
  })

  test('a signed-out CLI refuses turns with its own reason', async () => {
    presence = online(false)

    await expect(
      resolveLocalRuntimeEndpoint('t1', runtimeId, 'owner', 'transport', deps),
    ).rejects.toMatchObject({ code: 'runtime_login_required' })
  })
})

describe('team Box runtime authorization before transport or wake', () => {
  test('uses the persistent owner and denies login, revoked use, missing membership and forged owner', async () => {
    const box = {
      ...device('host', 'box', 'Shared'),
      box: {
        provider: 'instabox' as const,
        teamId: 't1',
        createdBy: 'creator',
        access: { everyone: false, userIds: ['teammate'] },
      },
    }
    const id = localRuntimeId({ userId: 'host', deviceId: 'box', provider: 'claude-code' })
    const calls: string[] = []
    const shared: LocalRuntimeCatalogDeps = {
      ...deps,
      access: { ...deps.access, listBoxes: async () => [box] },
      getPresence: async (owner) => {
        calls.push(`presence:${owner}`)

        return null
      },
      wakeDevice: async (owner) => {
        calls.push(`wake:${owner}`)

        return online()
      },
    }

    expect(
      (await resolveLocalRuntimeEndpoint('t1', id, 'teammate', 'transport', shared)).local,
    ).toEqual({ userId: 'host', deviceId: 'box' })
    expect(calls).toEqual(['presence:host', 'wake:host'])
    calls.length = 0
    await expect(
      resolveLocalRuntimeEndpoint('t1', id, 'teammate', 'login', shared),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      resolveLocalRuntimeEndpoint('t2', id, 'teammate', 'transport', shared),
    ).rejects.toMatchObject({ status: 404 })
    const forged = localRuntimeId({
      userId: 'someone-else',
      deviceId: 'box',
      provider: 'claude-code',
    })

    await expect(
      resolveLocalRuntimeEndpoint('t1', forged, 'teammate', 'control', shared),
    ).rejects.toMatchObject({ status: 404 })
    box.box.access.userIds = []
    for (const purpose of ['transport', 'control', 'login'] as const)
      await expect(
        resolveLocalRuntimeEndpoint('t1', id, 'teammate', purpose, shared),
      ).rejects.toMatchObject({ status: 404 })
    box.box.access.userIds = ['teammate']
    teams.delete('teammate:t1')
    await expect(
      resolveLocalRuntimeEndpoint('t1', id, 'teammate', 'transport', shared),
    ).rejects.toMatchObject({ status: 404 })
    expect(calls).toEqual([])
  })

  test('catalog uses owner presence and excludes a Box returned from a different team', async () => {
    const box = {
      ...device('host', 'box', 'Shared'),
      box: {
        provider: 'instabox' as const,
        teamId: 't1',
        access: { everyone: false, userIds: ['teammate'] },
      },
    }
    const owners: string[] = []
    const shared: LocalRuntimeCatalogDeps = {
      ...deps,
      access: { ...deps.access, listBoxes: async () => [box] },
      getPresence: async (owner) => {
        owners.push(owner)

        return online()
      },
    }

    expect((await listOwnLocalRuntimes('t1', 'teammate', shared))[0]?.local.ownerUserId).toBe(
      'host',
    )
    expect(owners).toEqual(['host'])
    box.box.teamId = 't2'
    expect(await listOwnLocalRuntimes('t1', 'teammate', shared)).toEqual([])
  })
})
