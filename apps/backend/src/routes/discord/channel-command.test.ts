import { describe, expect, test } from 'bun:test'

import { DiscordApiError } from '@/lib/discord/api'

import {
  canManageDiscordChannel,
  disableDiscordChannel,
  handleDiscordChannelCommand,
  parseDiscordChannelCommand,
} from './channel-command'

import type {
  DiscordChannelCommandDependencies,
  DiscordCommandInteraction,
  DisableDiscordChannelDependencies,
} from './channel-command'
import type { DiscordDecision } from '@/lib/discord/store'

const interaction = (command: 'enable' | 'disable'): DiscordCommandInteraction => ({
  guild_id: 'guild-1',
  channel_id: 'thread-1',
  member: { permissions: '16', user: { id: 'discord-user-1' } },
  data: { name: 'nuphos', options: [{ type: 1, name: command }] },
})

function dependencies(overrides: Partial<DiscordChannelCommandDependencies> = {}) {
  const calls = { enabled: [] as unknown[], disabled: [] as unknown[] }
  const value: DiscordChannelCommandDependencies = {
    findInstallation: async () => ({ teamId: 'team-1' }),
    findUserMapping: async () => ({ nuphosUserId: 'nuphos-user-1' }),
    findMembership: async () => ({ role: 'ADMINISTRATOR' }),
    getChannel: async () => ({
      id: 'thread-1',
      type: 11,
      guild_id: 'guild-1',
      parent_id: 'channel-1',
    }),
    enableChannel: async (args) => {
      calls.enabled.push(args)
    },
    disableChannel: async (args) => {
      calls.disabled.push(args)
    },
    ...overrides,
  }

  return { calls, value }
}

describe('Discord channel management command admission', () => {
  test('accepts only nuphos enable and disable subcommands', () => {
    expect(
      parseDiscordChannelCommand({
        data: { name: 'nuphos', options: [{ type: 1, name: 'enable' }] },
      }),
    ).toBe('enable')
    expect(
      parseDiscordChannelCommand({
        data: { name: 'nuphos', options: [{ type: 1, name: 'disable' }] },
      }),
    ).toBe('disable')
    expect(
      parseDiscordChannelCommand({
        data: { name: 'nuphos', options: [{ type: 1, name: 'ask' }] },
      }),
    ).toBeNull()
    expect(parseDiscordChannelCommand({ data: { name: 'other' } })).toBeNull()
  })

  test('requires the Discord Manage Channels permission bit', () => {
    expect(canManageDiscordChannel('16')).toBe(true)
    expect(canManageDiscordChannel('24')).toBe(true)
    expect(canManageDiscordChannel('8')).toBe(true)
    expect(canManageDiscordChannel('4')).toBe(false)
    expect(canManageDiscordChannel('not-a-bitfield')).toBe(false)
    expect(canManageDiscordChannel()).toBe(false)
  })

  test('does not mutate access for an unlinked or non-admin Nuphos user', async () => {
    const unlinked = dependencies({ findUserMapping: async () => null })
    const member = dependencies({ findMembership: async () => ({ role: 'MEMBER' }) })

    expect(await handleDiscordChannelCommand(interaction('enable'), unlinked.value)).toContain(
      'workspace administrator',
    )
    expect(await handleDiscordChannelCommand(interaction('disable'), member.value)).toContain(
      'workspace administrator',
    )
    expect(unlinked.calls).toEqual({ enabled: [], disabled: [] })
    expect(member.calls).toEqual({ enabled: [], disabled: [] })
  })

  test('enables the parent channel only after both authorization checks pass', async () => {
    const deps = dependencies()

    expect(await handleDiscordChannelCommand(interaction('enable'), deps.value)).toContain(
      'enabled',
    )
    expect(deps.calls.enabled).toEqual([
      {
        teamId: 'team-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        nuphosUserId: 'nuphos-user-1',
      },
    ])
    expect(deps.calls.disabled).toEqual([])
  })

  test('disables the parent channel through the approval-invalidating operation', async () => {
    const deps = dependencies()

    expect(await handleDiscordChannelCommand(interaction('disable'), deps.value)).toContain(
      'disabled',
    )
    expect(deps.calls.disabled).toEqual([
      { teamId: 'team-1', guildId: 'guild-1', channelId: 'channel-1' },
    ])
    expect(deps.calls.enabled).toEqual([])
  })

  test('disabling persists and rejects approvals atomically before resolving waits', async () => {
    const order: string[] = []
    const session = { id: 'session-1' }
    const decisions = [{ _id: 'decision-1' }] as unknown as DiscordDecision[]
    const dependencies: DisableDiscordChannelDependencies = {
      runTransaction: async (callback) => {
        order.push('transaction:start')
        await callback(session)
        order.push('transaction:commit')
      },
      disableMapping: async (args, receivedSession) => {
        expect(args).toEqual({ teamId: 'team-1', guildId: 'guild-1', channelId: 'channel-1' })
        expect(receivedSession).toBe(session)
        order.push('mapping:disable')
      },
      rejectApprovals: async (args, receivedSession) => {
        expect(args.channelId).toBe('channel-1')
        expect(receivedSession).toBe(session)
        order.push('approvals:reject')

        return decisions
      },
      resolveApprovals: async (receivedDecisions, reason) => {
        expect(receivedDecisions).toBe(decisions)
        expect(reason).toBe('discord_channel_disabled')
        order.push('approvals:resolve')
      },
    }

    await disableDiscordChannel(
      { teamId: 'team-1', guildId: 'guild-1', channelId: 'channel-1' },
      dependencies,
    )
    expect(order).toEqual([
      'transaction:start',
      'mapping:disable',
      'approvals:reject',
      'transaction:commit',
      'approvals:resolve',
    ])
  })
})

describe('Discord channel verification errors', () => {
  test('explains missing bot access without enabling the channel', async () => {
    const deps = dependencies({
      getChannel: async () => {
        throw new DiscordApiError(403, 50001, 'Missing Access')
      },
    })
    const reply = await handleDiscordChannelCommand(interaction('enable'), deps.value)

    expect(reply).toContain('Edit Channel → Permissions')
    expect(reply).toContain('View Channel')
    expect(reply).toContain('private thread')
    expect(deps.calls).toEqual({ enabled: [], disabled: [] })
  })

  test('distinguishes missing channels from temporary API failures', async () => {
    for (const [status, message] of [
      [404, 'could not find'],
      [500, 'temporarily'],
    ] as const) {
      const deps = dependencies({
        getChannel: async () => {
          throw new DiscordApiError(status, undefined, 'failed')
        },
      })

      expect(await handleDiscordChannelCommand(interaction('enable'), deps.value)).toContain(
        message,
      )
      expect(deps.calls).toEqual({ enabled: [], disabled: [] })
    }
  })

  test('continues rejecting a channel from another server', async () => {
    const deps = dependencies({
      getChannel: async () => ({ id: 'thread-1', type: 0, guild_id: 'other-guild' }),
    })

    expect(await handleDiscordChannelCommand(interaction('enable'), deps.value)).toContain(
      'could not verify',
    )
    expect(deps.calls).toEqual({ enabled: [], disabled: [] })
  })
})
