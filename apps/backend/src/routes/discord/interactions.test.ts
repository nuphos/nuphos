import { describe, expect, test } from 'bun:test'

import { dispatchDiscordInteraction, processDiscordInteraction } from './interactions'
import { handleDiscordModeCommand } from './mode-command'

import type {
  DiscordDeliveryDependencies,
  DiscordInteraction,
  DiscordInteractionDependencies,
} from './interactions'
import type { DiscordModeDependencies } from './mode-command'

const interaction: DiscordInteraction = {
  id: 'interaction',
  application_id: 'application',
  token: 'test-token',
  type: 3,
  guild_id: 'guild',
  channel_id: 'thread',
  member: { user: { id: 'discord-user' } },
  data: { custom_id: 'nuphos:tool:approve:decision' },
  message: { id: 'card' },
}

function approvalDependencies(
  options: { linked?: boolean; enabled?: boolean; active?: boolean } = {},
) {
  const calls = { resolved: [] as unknown[], claims: 0 }
  const decision = {
    guildId: 'guild',
    teamId: 'team',
    actorUserId: 'actor',
    sessionId: 'session',
    ref: 'tool',
  }
  const dependencies = {
    discordDecisions: () => ({
      findOne: async () => decision,
      findOneAndUpdate: async () => {
        calls.claims++

        return decision
      },
    }),
    discordUserMappings: () => ({
      findOne: async () => (options.linked === false ? null : { nuphosUserId: 'actor' }),
    }),
    getTeamMembership: async () => ({ role: 'MEMBER' }),
    findPreviewWaitByRef: async () =>
      options.active === false ? null : { sessionId: 'session', userId: 'actor', waitId: 'wait' },
    claimDiscordApproval: async () => {
      if (options.enabled === false) return 'revoked'
      calls.claims++

      return 'claimed'
    },
    invalidateDiscordApprovals: async () => {},
    resolvePreviewDecision: async (args: unknown) => {
      calls.resolved.push(args)

      return true
    },
  } as unknown as DiscordInteractionDependencies

  return { calls, dependencies }
}

describe('Discord approvals', () => {
  test('Allow once resolves the exact actor wait and removes buttons', async () => {
    const { calls, dependencies } = approvalDependencies()
    const result = await processDiscordInteraction(interaction, dependencies)

    expect(calls.resolved).toEqual([
      { userId: 'actor', sessionId: 'session', waitId: 'wait', payload: { decision: 'approved' } },
    ])
    expect(result).toMatchObject({ type: 7, data: { components: [] } })
  })
  test('Reject resolves the wait as rejected', async () => {
    const { calls, dependencies } = approvalDependencies()

    await processDiscordInteraction(
      { ...interaction, data: { custom_id: 'nuphos:tool:reject:decision' } },
      dependencies,
    )
    expect(calls.resolved[0]).toMatchObject({ payload: { decision: 'rejected' } })
  })
  test('wrong actor, revoked channel, and expired waits cannot approve', async () => {
    for (const options of [{ linked: false }, { enabled: false }, { active: false }]) {
      const { calls, dependencies } = approvalDependencies(options)

      expect((await processDiscordInteraction(interaction, dependencies)).type).toBe(4)
      expect(calls.resolved).toEqual([])
      expect(calls.claims).toBe(0)
    }
  })
  test('HTTP responds immediately while processing is deferred', async () => {
    let started = false
    let finish: (() => void) | undefined
    const delivered = new Promise<void>((resolve) => {
      finish = resolve
    })
    const dependencies = {
      process: async () => {
        started = true

        return { type: 4, data: { content: 'done' } }
      },
      editResponse: async () => {
        finish?.()
      },
    } as unknown as DiscordDeliveryDependencies

    expect(await dispatchDiscordInteraction(interaction, 'http', dependencies)).toEqual({
      type: 5,
      data: { flags: 64 },
    })
    expect(started).toBe(false)
    await delivered
    expect(started).toBe(true)
  })
  test('Gateway acknowledges first and then completes the card and ephemeral response', async () => {
    const order: string[] = []
    const dependencies = {
      acknowledge: async () => {
        order.push('ack')
      },
      process: async () => {
        order.push('process')

        return { type: 7, data: { content: 'approved', components: [] } }
      },
      editMessage: async () => {
        order.push('card')
      },
      editResponse: async () => {
        order.push('response')
      },
    } as unknown as DiscordDeliveryDependencies

    await dispatchDiscordInteraction(interaction, 'gateway', dependencies)
    expect(order).toEqual(['ack', 'process', 'card', 'response'])
  })
})

describe('Discord thread mode commands', () => {
  test('a linked ordinary member can change only their own mode', async () => {
    const changes: unknown[] = []
    const dependencies = {
      discordAgentThreads: () => ({
        findOne: async () => ({
          teamId: 'team',
          sessionId: 'session',
          agentUserId: 'owner',
          generation: 1,
          parentChannelId: 'channel',
        }),
      }),
      discordInstallations: () => ({ findOne: async () => ({}) }),
      discordChannelMappings: () => ({ findOne: async () => ({}) }),
      discordUserMappings: () => ({ findOne: async () => ({ nuphosUserId: 'actor' }) }),
      getTeamMembership: async () => ({ role: 'MEMBER' }),
      setSessionBypass: async (...args: unknown[]) => {
        changes.push(args)
      },
    } as unknown as DiscordModeDependencies

    for (const command of ['full-access', 'auto']) {
      await handleDiscordModeCommand(
        { ...interaction, data: { name: 'nuphos', options: [{ type: 1, name: command }] } },
        dependencies,
      )
    }
    expect(changes).toEqual([
      ['session', 'actor', true],
      ['session', 'actor', false],
    ])
  })
})
