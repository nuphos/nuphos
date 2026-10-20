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
}

describe('multiple instances of one provider', () => {
  test('stable ids and URLs round trip without changing legacy aliases', () => {
    expect(localRuntimeId(ref)).toBe('local_owner_box-1')
    expect(localRuntimeId({ ...ref, provider: 'codex' })).toBe('local_owner_box-1_codex')
    for (const provider of ['claude-code', 'codex', 'grok', 'opencode'] as LocalAgentProvider[]) {
      const instance = { ...ref, provider, instanceId: a }
      const agent = { ...ref, provider }

      expect(parseLocalRuntimeId(localRuntimeId(agent))).toEqual(agent)
      expect(parseLocalRuntimeUrl(localRuntimeUrl(agent, 'team'))).toEqual({
        ...agent,
        teamId: 'team',
        actorId: agent.userId,
      })

      expect(parseLocalRuntimeId(localRuntimeId(instance))).toEqual(instance)
      expect(parseLocalRuntimeUrl(localRuntimeUrl(instance, 'team'))).toEqual({
        ...instance,
        teamId: 'team',
        actorId: instance.userId,
      })
    }
    expect(parseLocalRuntimeId('local_owner_box-1_claude-code_not-a-uuid')).toBeUndefined()
    // Claude Code's default agent keeps its suffix-free id; no second spelling of it parses.
    expect(parseLocalRuntimeId('local_owner_box-1_claude-code')).toBeUndefined()
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
      // Chat needs the agent in the computer's report; sign-in goes to that exact agent
      // (the host refuses an id it does not have) and never to the provider's default.
      await expect(
        resolveLocalRuntimeEndpoint('team', id, 'owner', 'transport', deps),
      ).rejects.toMatchObject({ code: 'runtime_offline' })
      const login = await resolveLocalRuntimeEndpoint('team', id, 'owner', 'login', deps)

      expect(parseLocalRuntimeUrl(login.url)).toMatchObject({
        instanceId: parseLocalRuntimeId(id)?.instanceId,
        provider: parseLocalRuntimeId(id)?.provider,
      })
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
  expect(
    (await resolveLocalRuntimeEndpoint('team', id, 'member', 'login', boxDeps)).runtimeId,
  ).toBe(id)
  reads = 0
  await expect(
    resolveLocalRuntimeEndpoint('team', id, 'unlisted', 'transport', boxDeps),
  ).rejects.toMatchObject({ code: 'runtime_not_found' })
  await expect(
    resolveLocalRuntimeEndpoint('team', id, 'unlisted', 'login', boxDeps),
  ).rejects.toMatchObject({ code: 'runtime_not_found' })
  await expect(
    resolveLocalRuntimeEndpoint('other', id, 'admin', 'login', boxDeps),
  ).rejects.toMatchObject({ code: 'runtime_not_found' })
  expect(reads).toBe(0)
  expect((await resolveLocalRuntimeEndpoint('team', id, 'admin', 'login', boxDeps)).runtimeId).toBe(
    id,
  )
})

describe('an agent still signing in for the first time', () => {
  const pending = '33333333-3333-4333-8333-333333333333'
  const withPending = localRuntimeStatusSchema.parse({
    ...status,
    instances: [
      ...(status.instances ?? []),
      {
        instanceId: pending,
        provider: 'codex',
        label: 'Codex',
        state: 'pending',
        cli: { installed: true, loggedIn: false },
      },
    ],
  })
  const pendingDeps: LocalRuntimeCatalogDeps = {
    ...deps,
    getPresence: async () => ({ conn: 'c1', seenAt: Date.now(), status: withPending }),
  }
  const id = localRuntimeId({ ...ref, provider: 'codex', instanceId: pending })

  test('is not listed, but its sign-in reaches it and nothing else does', async () => {
    const listed = await listOwnLocalRuntimes('team', 'owner', pendingDeps)

    expect(listed.map((instance) => instance.id)).not.toContain(id)
    expect(listed).toHaveLength(3)
    await expect(
      resolveLocalRuntimeEndpoint('team', id, 'owner', 'login', pendingDeps),
    ).resolves.toMatchObject({ runtimeId: id })
    await expect(
      resolveLocalRuntimeEndpoint('team', id, 'owner', 'transport', pendingDeps),
    ).rejects.toThrow()
  })
})

describe('a computer that went offline', () => {
  const box = {
    ...ref,
    label: 'Box',
    platform: 'linux',
    allowLocalExec: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    agents: [
      { provider: 'claude-code' as const, signedIn: true },
      { provider: 'claude-code' as const, instanceId: a, label: 'Work', signedIn: true },
    ],
  }
  const offline: LocalRuntimeCatalogDeps = {
    ...deps,
    access: { ...deps.access, getDevice: async () => box, listDevices: async () => [box] },
    getPresence: async () => null,
  }

  test('keeps its agents listed as offline, with the sign-in it last reported', async () => {
    const listed = await listOwnLocalRuntimes('team', 'owner', offline)

    expect(
      listed.map(({ id, local }) => [id, local?.online, local?.signedIn, local?.instanceId]),
    ).toEqual([
      [localRuntimeId(ref), false, true, undefined],
      [localRuntimeId({ ...ref, instanceId: a }), false, true, a],
    ])
    // Listed is not reachable: a turn there is refused, never sent to another agent.
    await expect(
      resolveLocalRuntimeEndpoint(
        'team',
        localRuntimeId({ ...ref, instanceId: a }),
        'owner',
        'transport',
        offline,
      ),
    ).rejects.toMatchObject({ code: 'runtime_offline' })
  })

  test('comes back online with the same ids', async () => {
    const back = await listOwnLocalRuntimes('team', 'owner', {
      ...offline,
      getPresence: async () => ({ conn: 'c1', seenAt: Date.now(), status }),
    })

    expect(back.filter(({ local }) => local?.online).map(({ id }) => id)).toEqual(
      expect.arrayContaining([localRuntimeId(ref), localRuntimeId({ ...ref, instanceId: a })]),
    )
    expect(new Set(back.map(({ id }) => id)).size).toBe(back.length)
  })
})

describe('signing in an agent the computer has not reported yet', () => {
  const added = localRuntimeId({ ...ref, instanceId: '44444444-4444-4444-8444-444444444444' })

  test('login right after create reaches the computer before its next report', async () => {
    const endpoint = await resolveLocalRuntimeEndpoint('team', added, 'owner', 'login', deps)

    expect(endpoint).toMatchObject({ runtimeId: added, authKey: 'control' })
  })

  test('a computer that is not connected still refuses the sign-in as offline', async () => {
    await expect(
      resolveLocalRuntimeEndpoint('team', added, 'owner', 'login', {
        ...deps,
        getPresence: async () => null,
      }),
    ).rejects.toMatchObject({ code: 'runtime_offline' })
  })
})
