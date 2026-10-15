import { describe, expect, test } from 'bun:test'

import {
  localRuntimeId,
  localRuntimeUrl,
  parseLocalRuntimeId,
  parseLocalRuntimeUrl,
} from '@/lib/agent/devices/local-runtime/address'
import { localRuntimeStatusSchema } from '@/lib/agent/devices/local-runtime/protocol'

import {
  listOwnLocalRuntimes,
  localRuntimeModels,
  resolveLocalRuntimeEndpoint,
} from './local-runtime-catalog'

import type { LocalRuntimeCatalogDeps } from './local-runtime-catalog'
import type { LocalAgentProvider } from '@/lib/agent/devices/local-runtime/protocol'

const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const ref = { userId: 'owner', deviceId: 'box-1', provider: 'claude-code' as const }
const catalog = (name: string) => ({
  models: [{ id: name, name }],
  defaultModel: name,
  controls: {},
})
const status = localRuntimeStatusSchema.parse({
  agents: {
    'claude-code': { cli: { installed: true, loggedIn: true }, models: catalog('default') },
  },
  agentInstances: true,
  instances: [
    {
      instanceId: a,
      provider: 'claude-code',
      label: 'Work',
      cli: { installed: true, loggedIn: true },
      models: catalog('work'),
    },
    {
      instanceId: b,
      provider: 'claude-code',
      label: 'Personal',
      cli: { installed: true, loggedIn: false },
      models: catalog('personal'),
    },
  ],
})
const deps: LocalRuntimeCatalogDeps = {
  access: {
    getDevice: async (userId) =>
      userId === 'owner'
        ? {
            ...ref,
            label: 'Box',
            platform: 'linux',
            allowLocalExec: true,
            createdAt: new Date(0),
            updatedAt: new Date(0),
          }
        : null,
    listDevices: async () => [
      {
        ...ref,
        label: 'Box',
        platform: 'linux',
        allowLocalExec: true,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    ],
    listBoxes: async () => [],
    role: async () => null,
  },
  isMember: async (userId, teamId) => userId === 'owner' && teamId === 'team',
  getPresence: async () => ({ conn: 'c1', seenAt: Date.now(), status }),
  wakeDevice: async () => undefined,
}

describe('multiple instances of one provider', () => {
  test('stable ids and URLs round trip without changing legacy aliases', () => {
    expect(localRuntimeId(ref)).toBe('local_owner_box-1')
    expect(localRuntimeId({ ...ref, provider: 'codex' })).toBe('local_owner_box-1_codex')
    for (const provider of ['claude-code', 'codex'] as LocalAgentProvider[]) {
      const instance = { ...ref, provider, instanceId: a }

      expect(parseLocalRuntimeId(localRuntimeId(instance))).toEqual(instance)
      expect(parseLocalRuntimeUrl(localRuntimeUrl(instance, 'team'))).toEqual({
        ...instance,
        teamId: 'team',
        actorId: instance.userId,
      })
    }
    expect(parseLocalRuntimeId('local_owner_box-1_claude-code_not-a-uuid')).toBeUndefined()
    expect(
      parseLocalRuntimeUrl('nuphos-device://runtime/owner/box-1?team=team&instance='),
    ).toBeUndefined()
    expect(
      parseLocalRuntimeUrl('nuphos-device://runtime/owner/box-1?team=team&provider=unknown'),
    ).toBeUndefined()
  })

  test('catalog, login and models resolve exactly the selected instance', async () => {
    const listed = await listOwnLocalRuntimes('team', 'owner', deps)

    expect(listed).toHaveLength(3)
    expect(new Set(listed.map((item) => item.id)).size).toBe(3)
    expect(listed.map((item) => item.local.instanceId)).toEqual([undefined, a, b])
    const idA = localRuntimeId({ ...ref, instanceId: a })
    const idB = localRuntimeId({ ...ref, instanceId: b })

    expect(await localRuntimeModels(idA, undefined, deps)).toMatchObject({
      models: [{ id: 'work' }],
    })
    expect(await localRuntimeModels(idB, undefined, deps)).toMatchObject({
      models: [{ id: 'personal' }],
    })
    expect(
      parseLocalRuntimeUrl(
        (await resolveLocalRuntimeEndpoint('team', idA, 'owner', 'transport', deps)).url,
      ),
    ).toMatchObject({ instanceId: a })
    await expect(
      resolveLocalRuntimeEndpoint('team', idB, 'owner', 'transport', deps),
    ).rejects.toMatchObject({ code: 'runtime_login_required' })
    expect((await resolveLocalRuntimeEndpoint('team', idB, 'owner', 'login', deps)).authKey).toBe(
      'control',
    )
  })

  test('unknown instance and wrong provider never fall back to signed-in default', async () => {
    const missing = localRuntimeId({ ...ref, instanceId: '33333333-3333-4333-8333-333333333333' })
    const wrongProvider = localRuntimeId({ ...ref, provider: 'codex', instanceId: a })

    for (const id of [missing, wrongProvider]) {
      await expect(
        resolveLocalRuntimeEndpoint('team', id, 'owner', 'login', deps),
      ).rejects.toMatchObject({ code: 'runtime_offline' })
      expect((await localRuntimeModels(id, undefined, deps)).models).toEqual([])
    }
    await expect(
      resolveLocalRuntimeEndpoint(
        'team',
        localRuntimeId({ ...ref, instanceId: a }),
        'other',
        'login',
        deps,
      ),
    ).rejects.toMatchObject({ code: 'runtime_not_found' })
  })

  test('duplicate ids are refused while usage secrets are stripped', () => {
    expect(
      localRuntimeStatusSchema.safeParse({
        ...status,
        instances: [status.instances![0], status.instances![0]],
      }).success,
    ).toBe(false)
    const parsed = localRuntimeStatusSchema.parse({
      ...status,
      instances: [
        {
          ...status.instances![0],
          usage: { accessToken: 'never-forward', five_hour: { utilization: 12 } },
        },
      ],
    })

    expect(parsed.instances![0]!.usage).toEqual({ five_hour: { utilization: 12 } })
  })
})

test('Box instance use and login apply actor ACL before reading transport presence', async () => {
  let reads = 0
  const box = {
    userId: 'owner',
    deviceId: ref.deviceId,
    label: 'Team Box',
    platform: 'linux',
    allowLocalExec: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    box: {
      provider: 'instabox' as const,
      sandboxId: 's1',
      state: 'running' as const,
      updatedAt: new Date(0),
      teamId: 'team',
      createdBy: 'owner',
      access: { everyone: false, userIds: ['member'] },
    },
  }
  const boxDeps: LocalRuntimeCatalogDeps = {
    ...deps,
    access: {
      getDevice: async () => box,
      listDevices: async () => [box],
      listBoxes: async (teamId) => (teamId === 'team' ? [box] : []),
      role: async (actorId) => (actorId === 'admin' ? 'ADMINISTRATOR' : 'EDITOR'),
    },
    isMember: async () => true,
    getPresence: async (owner) => {
      reads++
      expect(owner).toBe('owner')

      return { conn: 'c1', seenAt: Date.now(), status }
    },
  }
  const id = localRuntimeId({ ...ref, instanceId: a })

  expect(
    (await resolveLocalRuntimeEndpoint('team', id, 'member', 'transport', boxDeps)).runtimeId,
  ).toBe(id)
  reads = 0
  await expect(
    resolveLocalRuntimeEndpoint('team', id, 'member', 'login', boxDeps),
  ).rejects.toMatchObject({ code: 'runtime_not_found' })
  await expect(
    resolveLocalRuntimeEndpoint('team', id, 'unlisted', 'transport', boxDeps),
  ).rejects.toMatchObject({ code: 'runtime_not_found' })
  await expect(
    resolveLocalRuntimeEndpoint('other', id, 'admin', 'login', boxDeps),
  ).rejects.toMatchObject({ code: 'runtime_not_found' })
  expect(reads).toBe(0)
  expect((await resolveLocalRuntimeEndpoint('team', id, 'admin', 'login', boxDeps)).runtimeId).toBe(
    id,
  )
})
