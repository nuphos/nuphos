import { describe, expect, test } from 'bun:test'

import { completeDiscordOAuth, disconnectDiscord } from './lifecycle'

import type { DiscordInstallation, DiscordPendingOAuth } from '@/lib/discord/store'

type Dependencies = NonNullable<Parameters<typeof completeDiscordOAuth>[1]>

const pending: DiscordPendingOAuth = {
  _id: 'state-a',
  operation: 'install',
  teamId: 'team-a',
  requesterUserId: 'user-a',
  expiresAt: new Date(Date.now() + 60_000),
}

function fixture() {
  const calls: { operation: string; filter: Record<string, unknown>; session: unknown }[] = []
  const session = {
    withTransaction: async (fn: () => Promise<void>) => await fn(),
    endSession: async () => {},
  }
  let claimable = true
  let installation: DiscordInstallation | null = null
  const resolved: string[] = []
  const record =
    (operation: string) =>
    async (filter: Record<string, unknown>, options: { session: unknown }) => {
      calls.push({ operation, filter, session: options.session })

      return { deletedCount: 1 }
    }
  const deps = {
    startSession: () => session,
    discordPendingOAuth: () => ({
      deleteOne: async (filter: Record<string, unknown>, options: { session: unknown }) => {
        await record('consume-state')(filter, options)

        return { deletedCount: claimable ? 1 : 0 }
      },
      deleteMany: async (filter: Record<string, unknown>, options: { session: unknown }) => {
        claimable = false

        return await record('delete-states')(filter, options)
      },
    }),
    discordInstallations: () => ({
      findOne: async () => installation,
      updateOne: async (
        filter: Record<string, unknown>,
        update: { $set: DiscordInstallation },
        options: { session: unknown },
      ) => {
        installation = update.$set
        await record('install')(filter, options)
      },
      deleteOne: async (filter: Record<string, unknown>, options: { session: unknown }) => {
        installation = null

        return await record('delete-installation')(filter, options)
      },
    }),
    discordChannelMappings: () => ({ deleteMany: record('delete-channels') }),
    discordUserMappings: () => ({
      findOne: async () => null,
      updateOne: async (
        filter: Record<string, unknown>,
        _update: unknown,
        options: { session: unknown },
      ) => await record('link-user')(filter, options),
      deleteMany: record('delete-users'),
    }),
    markDiscordApprovalsRejected: async (filter: Record<string, unknown>, tx: unknown) => {
      await record('reject-approvals')(filter, { session: tx })

      return []
    },
    resolveInvalidatedDiscordApprovals: async (_decisions: unknown, reason: string) => {
      resolved.push(reason)
    },
  } as unknown as Dependencies

  return {
    deps,
    calls,
    session,
    resolved,
    allowNewOAuth: () => {
      claimable = true
    },
  }
}

describe('Discord installation lifecycle', () => {
  test('disconnect scopes all cleanup to the team in one transaction', async () => {
    const f = fixture()

    await disconnectDiscord('team-a', f.deps)
    expect(f.calls.map((call) => call.operation)).toEqual([
      'reject-approvals',
      'delete-installation',
      'delete-channels',
      'delete-users',
      'delete-states',
    ])
    for (const call of f.calls) {
      expect(call.filter).toEqual({ teamId: 'team-a' })
      expect(call.session).toBe(f.session)
    }
    expect(f.resolved).toEqual(['discord_disconnected'])
  })

  test('a callback exchanging a code before disconnect cannot recreate the binding', async () => {
    const f = fixture()

    await disconnectDiscord('team-a', f.deps)
    await expect(
      completeDiscordOAuth(
        { pending, discordUserId: 'discord-a', guild: { id: 'old-server', name: 'Old' } },
        f.deps,
      ),
    ).rejects.toThrow('expired_state')
    expect(
      f.calls.some((call) => call.operation === 'install' || call.operation === 'link-user'),
    ).toBe(false)
  })

  test('fresh OAuth after disconnect can bind a different server', async () => {
    const f = fixture()

    await disconnectDiscord('team-a', f.deps)
    f.allowNewOAuth()
    const installed = await completeDiscordOAuth(
      { pending, discordUserId: 'discord-a', guild: { id: 'new-server', name: 'New' } },
      f.deps,
    )

    expect(installed.guildId).toBe('new-server')
    expect(installed.teamId).toBe('team-a')
    expect(installed.generation).toBeGreaterThan(1)
    const writes = f.calls.filter((call) =>
      ['consume-state', 'install', 'link-user'].includes(call.operation),
    )

    expect(writes.map((call) => call.operation)).toEqual(['consume-state', 'install', 'link-user'])
    for (const call of writes) expect(call.session).toBe(f.session)
  })

  test('link-only callbacks cannot install a server after disconnect', async () => {
    const f = fixture()

    await expect(
      completeDiscordOAuth(
        {
          pending: { ...pending, operation: 'link', expectedGuildId: 'old-server' },
          discordUserId: 'discord-a',
        },
        f.deps,
      ),
    ).rejects.toThrow('installation_changed')
    expect(f.calls.some((call) => call.operation === 'link-user')).toBe(false)
  })
})
