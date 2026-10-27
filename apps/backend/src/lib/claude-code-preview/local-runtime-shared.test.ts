import { describe, expect, test } from 'bun:test'

import {
  awaitsShareApproval,
  capShareLevel,
  exceedsCeiling,
  isUnattendedSource,
  sharedLevelFor,
} from '@/lib/agent/devices/local-share'
import { localRuntimeId, parseLocalRuntimeUrl } from '@/lib/agent/devices/local-runtime/address'
import { localRuntimeStatusSchema } from '@/lib/agent/devices/local-runtime/protocol'

import { sharedRuntimeUse } from './conversation-chat-route'
import { listOwnLocalRuntimes, resolveLocalRuntimeEndpoint } from './local-runtime-catalog'
import { acceptsRuntimeInstance } from './runtime-catalog'
import { requireModelRuntimeInstance } from './runtime-models'

import type { LocalShareDeps } from '@/lib/agent/devices/local-share'
import type { ShareApproval } from '@/lib/agent/devices/local-share-store'
import type { LocalAgentShare, LocalShareLevel } from '@/lib/agent/devices/local-share-types'
import type { AgentDevice } from '@/lib/agent/devices/store'
import type { LocalRuntimeCatalogDeps } from './local-runtime-catalog'
import type { RuntimeInstance } from './runtime-instances'

const computer = (shares?: LocalAgentShare[], box = false): AgentDevice => ({
  userId: 'owner',
  deviceId: 'mac',
  label: 'Owner’s Mac',
  platform: 'darwin',
  allowLocalExec: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...(shares ? { shares } : {}),
  ...(box ? { box: { provider: 'instabox' as const, teamId: 'team' } } : {}),
})
const share = (level: 'approve' | 'full', userIds = ['mate']): LocalAgentShare => ({
  teamId: 'team',
  level,
  everyone: false,
  userIds,
})
const status = localRuntimeStatusSchema.parse({
  agents: {
    'claude-code': {
      cli: { installed: true, loggedIn: true },
      models: { models: [], defaultModel: 'default', controls: {} },
    },
  },
})
const id = localRuntimeId({ userId: 'owner', deviceId: 'mac', provider: 'claude-code' })

function setup(options: {
  device: AgentDevice
  ceiling?: LocalShareLevel
  approval?: ShareApproval['status']
  members?: string[]
}) {
  const requested: string[] = []
  const members = options.members ?? ['owner', 'mate', 'other']
  const share: LocalShareDeps = {
    ceiling: async () => options.ceiling ?? 'full',
    isMember: async (userId) => members.includes(userId),
    listShared: async () => [options.device],
    getDevice: async (ownerId, deviceId) =>
      ownerId === options.device.userId && deviceId === options.device.deviceId
        ? options.device
        : null,
    findApproval: async () =>
      options.approval ? ({ status: options.approval } as ShareApproval) : null,
    requestApproval: async ({ sessionId }) => {
      requested.push(sessionId)
    },
  }
  const deps: LocalRuntimeCatalogDeps = {
    access: {
      // The teammate has no computers or Boxes of their own here.
      getDevice: async (userId) => (userId === 'owner' ? options.device : null),
      listDevices: async (userId) => (userId === 'owner' ? [options.device] : []),
      listBoxes: async () => [],
      role: async (userId) => (members.includes(userId) ? 'EDITOR' : null),
    },
    isMember: async (userId) => members.includes(userId),
    getPresence: async () => ({ conn: 'c1', seenAt: Date.now(), status }),
    share,
  }

  return { deps, requested }
}

describe('share levels', () => {
  test('the team ceiling caps what an owner grants', () => {
    expect(capShareLevel('full', 'approve')).toBe('approve')
    expect(capShareLevel('approve', 'full')).toBe('approve')
    expect(capShareLevel('full', 'off')).toBe('off')
    expect(exceedsCeiling('full', 'approve')).toBe(true)
    expect(exceedsCeiling('off', 'off')).toBe(false)
  })

  test('only people named in this team’s share, never the owner or a Box', () => {
    const device = computer([share('full')])

    expect(sharedLevelFor(device, 'mate', 'team', 'full')).toBe('full')
    expect(sharedLevelFor(device, 'mate', 'team', 'approve')).toBe('approve')
    expect(sharedLevelFor(device, 'mate', 'team', 'off')).toBeNull()
    expect(sharedLevelFor(device, 'other', 'team', 'full')).toBeNull()
    expect(sharedLevelFor(device, 'mate', 'elsewhere', 'full')).toBeNull()
    expect(sharedLevelFor(device, 'owner', 'team', 'full')).toBeNull()
    expect(sharedLevelFor(computer([share('full')], true), 'mate', 'team', 'full')).toBeNull()
    expect(
      sharedLevelFor(computer([{ ...share('full', []), everyone: true }]), 'other', 'team', 'full'),
    ).toBe('full')
  })

  test('channel, trigger, resource and agent-thread turns are unattended', () => {
    expect(isUnattendedSource('slack')).toBe(true)
    expect(isUnattendedSource('slack.channel')).toBe(true)
    expect(isUnattendedSource('lark')).toBe(true)
    expect(isUnattendedSource('agent.resource')).toBe(true)
    expect(isUnattendedSource('agent.thread')).toBe(true)
    expect(isUnattendedSource('slackware')).toBe(false)
    expect(isUnattendedSource('discord.thread')).toBe(true)
    expect(isUnattendedSource('agent.trigger')).toBe(true)
    expect(isUnattendedSource('agent.trigger.cron')).toBe(true)
    expect(isUnattendedSource('app')).toBe(false)
    expect(isUnattendedSource(undefined)).toBe(false)
  })
})

describe('a teammate’s conversation on a shared computer', () => {
  test('is listed for the people it is shared with, marked as shared', async () => {
    const { deps } = setup({ device: computer([share('full')]) })

    const listed = await listOwnLocalRuntimes('team', 'mate', deps)

    expect(listed.map((instance) => instance.id)).toEqual([id])
    expect(listed[0]?.local.shared).toEqual({ level: 'full' })
    expect(await listOwnLocalRuntimes('team', 'other', deps)).toEqual([])
  })

  test('runs as the teammate, never as the owner', async () => {
    const { deps } = setup({ device: computer([share('full')]) })

    const endpoint = await resolveLocalRuntimeEndpoint('team', id, 'mate', 'transport', deps, {
      sessionId: 's1',
      source: 'app',
    })

    expect(parseLocalRuntimeUrl(endpoint.url)?.actorId).toBe('mate')
  })

  test('is refused for anything but a conversation’s own calls', async () => {
    const { deps } = setup({ device: computer([share('full')]) })

    // Terminal, files, Box updates and the runtime lookup pass no conversation use.
    await expect(
      resolveLocalRuntimeEndpoint('team', id, 'mate', 'control', deps),
    ).rejects.toMatchObject({
      code: 'runtime_not_found',
    })
    await expect(
      resolveLocalRuntimeEndpoint('team', id, 'mate', 'login', deps, { sessionId: 's1' }),
    ).rejects.toMatchObject({ code: 'runtime_not_found' })
  })

  test('is refused for someone it is not shared with, or when sharing is off', async () => {
    const shared = setup({ device: computer([share('full')]) })
    const off = setup({ device: computer([share('full')]), ceiling: 'off' })

    await expect(
      resolveLocalRuntimeEndpoint('team', id, 'other', 'transport', shared.deps, {
        sessionId: 's1',
      }),
    ).rejects.toMatchObject({ code: 'runtime_not_found' })
    await expect(
      resolveLocalRuntimeEndpoint('team', id, 'mate', 'transport', off.deps, { sessionId: 's1' }),
    ).rejects.toMatchObject({ code: 'runtime_not_found' })
  })

  test('is refused once its owner has left the team', async () => {
    const { deps } = setup({ device: computer([share('full')]), members: ['mate'] })

    await expect(
      resolveLocalRuntimeEndpoint('team', id, 'mate', 'transport', deps, { sessionId: 's1' }),
    ).rejects.toMatchObject({ code: 'runtime_not_found' })
  })

  test('from a channel or a trigger never runs, even at full', async () => {
    const { deps } = setup({ device: computer([share('full')]) })

    await expect(
      resolveLocalRuntimeEndpoint('team', id, 'mate', 'transport', deps, {
        sessionId: 's1',
        source: 'slack.channel',
      }),
    ).rejects.toMatchObject({ code: 'local_share_unattended' })
  })

  test('at approve, asks the owner once and waits for their answer', async () => {
    const pending = setup({ device: computer([share('approve')]) })

    await expect(
      resolveLocalRuntimeEndpoint('team', id, 'mate', 'transport', pending.deps, {
        sessionId: 's1',
      }),
    ).rejects.toMatchObject({ code: 'local_share_approval_required' })
    expect(pending.requested).toEqual(['s1'])

    const approved = setup({ device: computer([share('approve')]), approval: 'approved' })

    expect(
      (
        await resolveLocalRuntimeEndpoint('team', id, 'mate', 'transport', approved.deps, {
          sessionId: 's1',
        })
      ).runtimeId,
    ).toBe(id)

    const denied = setup({ device: computer([share('approve')]), approval: 'denied' })

    await expect(
      resolveLocalRuntimeEndpoint('team', id, 'mate', 'transport', denied.deps, {
        sessionId: 's1',
      }),
    ).rejects.toMatchObject({ code: 'local_share_denied' })
  })

  test('a full share under an approve ceiling still asks', async () => {
    const { deps } = setup({ device: computer([share('full')]), ceiling: 'approve' })

    await expect(
      resolveLocalRuntimeEndpoint('team', id, 'mate', 'transport', deps, { sessionId: 's1' }),
    ).rejects.toMatchObject({ code: 'local_share_approval_required' })
  })

  test('the owner’s own conversation is unchanged', async () => {
    const { deps, requested } = setup({ device: computer([share('approve')]) })

    const endpoint = await resolveLocalRuntimeEndpoint('team', id, 'owner', 'transport', deps, {
      sessionId: 's1',
    })

    expect(parseLocalRuntimeUrl(endpoint.url)?.actorId).toBe('owner')
    expect(requested).toEqual([])
  })
})

describe('which conversation and origin a shared computer checks', () => {
  test('a brand-new chat is asked about by the id it is being created with', () => {
    expect(sharedRuntimeUse(null, { sessionId: 'new' })).toEqual({
      sessionId: 'new',
      source: undefined,
    })
  })

  test('a trigger or channel turn counts even on a conversation begun in the app', () => {
    expect(
      sharedRuntimeUse(
        { sessionId: 'chat', metadata: { source: 'desktop' } },
        { source: 'agent.trigger' },
      ),
    ).toEqual({ sessionId: 'chat', source: 'agent.trigger' })
    expect(
      sharedRuntimeUse({ sessionId: 'chat', metadata: { source: 'slack.thread' } }, {}),
    ).toEqual({ sessionId: 'chat', source: 'slack.thread' })
  })
})

test('terminal, files, desktop and sign-in never reach a teammate’s shared computer', () => {
  const local = (shared?: 'approve' | 'full') =>
    ({ id: 'x', kind: 'local', local: shared ? { shared } : {} }) as unknown as RuntimeInstance

  expect(acceptsRuntimeInstance(local('full'), {})).toBe(false)
  expect(acceptsRuntimeInstance(local('full'), { shared: true })).toBe(true)
  expect(acceptsRuntimeInstance(local(), {})).toBe(true)
})

test('a teammate’s shared computer offers its models to the person it is shared with', async () => {
  const calls: unknown[][] = []

  await requireModelRuntimeInstance('team', 'runtime', 'mate', (...args) => {
    calls.push(args)

    return Promise.resolve({ id: 'runtime' } as RuntimeInstance)
  })
  expect(calls).toEqual([['team', 'runtime', 'mate', { shared: true }]])
})

test('a teammate’s turns wait in the queue only while the owner has not answered', async () => {
  const runtimeId = localRuntimeId({ userId: 'owner', deviceId: 'mac', provider: 'codex' })
  const answered = (status?: ShareApproval['status']) => ({
    findApproval: async () => (status ? ({ status } as ShareApproval) : null),
  })
  const chat = { sessionId: 'chat', runtimeId }

  expect(await awaitsShareApproval(chat, 'mate', answered('pending'))).toBe(true)
  expect(await awaitsShareApproval(chat, 'mate', answered('approved'))).toBe(false)
  expect(await awaitsShareApproval(chat, 'mate', answered())).toBe(false)
  expect(await awaitsShareApproval(chat, 'owner', answered('pending'))).toBe(false)
  expect(await awaitsShareApproval({ sessionId: 'chat' }, 'mate', answered('pending'))).toBe(false)
})
