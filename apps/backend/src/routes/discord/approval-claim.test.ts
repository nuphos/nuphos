import { describe, expect, test } from 'bun:test'

import { claimDiscordApproval } from './approval-claim'

import type { DiscordApprovalClaimDependencies } from './approval-claim'
import type { DiscordDecision } from '@/lib/discord/store'

const decision: DiscordDecision = {
  _id: 'decision',
  kind: 'agent-permission',
  ref: 'tool',
  guildId: 'guild',
  channelId: 'thread',
  parentChannelId: 'channel',
  teamId: '111111111111111111111111',
  actorUserId: '222222222222222222222222',
  sessionId: 'session',
  installationGeneration: 3,
  status: 'pending',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
}

function fixture(revoked?: string, retryWithRevocation = false) {
  const writes: {
    grant: string
    filter: Record<string, unknown>
    update: Record<string, unknown>
    session: unknown
  }[] = []
  let currentRevocation = revoked
  let claims = 0
  let ended = false
  const session = {
    withTransaction: async (callback: () => Promise<void>) => {
      await callback()
      if (retryWithRevocation) {
        // Model Mongo aborting the first attempt on a concurrent grant write,
        // then replaying the transaction against the now-revoked mapping.
        currentRevocation = 'mapping'
        await callback()
      }
    },
    endSession: () => {
      ended = true

      return Promise.resolve()
    },
  }
  const grant = (name: string) => () => ({
    updateOne: (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options: { session: unknown },
    ) => {
      writes.push({ grant: name, filter, update, session: options.session })

      return Promise.resolve({ matchedCount: currentRevocation === name ? 0 : 1 })
    },
  })
  const dependencies = {
    mongo: { startSession: () => session },
    discordInstallations: grant('installation'),
    discordChannelMappings: grant('channel'),
    discordUserMappings: grant('mapping'),
    teams: grant('membership'),
    discordDecisions: () => ({
      findOneAndUpdate: (
        filter: Record<string, unknown>,
        update: Record<string, unknown>,
        options: { session: unknown },
      ) => {
        claims++
        writes.push({ grant: 'decision', filter, update, session: options.session })

        return Promise.resolve(decision)
      },
    }),
  } as unknown as DiscordApprovalClaimDependencies

  return { dependencies, writes, session, claims: () => claims, ended: () => ended }
}

describe('Discord approval atomic authorization', () => {
  test('fences all grants and claims the unexpired decision in one session', async () => {
    const f = fixture()

    expect(await claimDiscordApproval(decision, 'discord-user', 'approved', f.dependencies)).toBe(
      'claimed',
    )
    expect(f.writes.map((write) => write.grant)).toEqual([
      'installation',
      'channel',
      'mapping',
      'membership',
      'decision',
    ])
    expect(f.writes.every((write) => write.session === f.session)).toBe(true)
    expect(f.writes[2]?.filter).toMatchObject({
      discordUserId: 'discord-user',
      nuphosUserId: decision.actorUserId,
      teamId: decision.teamId,
      enabled: true,
    })
    expect(f.writes[3]?.filter).toMatchObject({
      deletedAt: { $exists: false },
      members: { $elemMatch: { deletedAt: { $exists: false } } },
    })
    for (const write of f.writes.slice(0, 4)) {
      const fence = (write.update.$set as { discordApprovalFence: string }).discordApprovalFence

      expect(typeof fence).toBe('string')
      expect(fence).toMatch(/^[a-f0-9-]{36}$/)
    }
    expect(f.writes[4]?.filter).toMatchObject({
      _id: decision._id,
      status: 'pending',
      expiresAt: { $gt: expect.any(Date) },
    })
    expect(f.ended()).toBe(true)
  })
  test('revoked actor mapping or membership cannot claim an approval after preflight', async () => {
    for (const grant of ['mapping', 'membership', 'channel', 'installation']) {
      const f = fixture(grant)

      expect(await claimDiscordApproval(decision, 'discord-user', 'approved', f.dependencies)).toBe(
        'revoked',
      )
      expect(f.claims()).toBe(0)
      expect(f.ended()).toBe(true)
    }
  })
  test('a transaction retried after revocation does not retain its earlier claimed result', async () => {
    const f = fixture(undefined, true)

    expect(await claimDiscordApproval(decision, 'discord-user', 'approved', f.dependencies)).toBe(
      'revoked',
    )
    expect(f.claims()).toBe(1)
    expect(f.writes.filter((write) => write.grant === 'mapping')).toHaveLength(2)
  })
})
