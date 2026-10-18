import { afterEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useModels } from '@/lib/test/doubles/models'

const TEAM = new ObjectId()
const CF_BINDING = new ObjectId()
const envelope = { alg: 'A256GCM', keyId: 'k', iv: 'i', authTag: 't', ciphertext: 'c' }
const results: unknown[] = []
let slackUpdateError: Error | null = null

useModels({
  teamByosBindings: () =>
    ({
      findOne: (filter: Record<string, unknown>) =>
        Promise.resolve(
          'cloudflareAccounts.accountId' in filter
            ? { cloudflareAccounts: [{ id: CF_BINDING }] }
            : { slackWorkspaces: [] },
        ),
      updateOne: () =>
        slackUpdateError
          ? Promise.reject(slackUpdateError)
          : Promise.resolve({ matchedCount: 1, modifiedCount: 1 }),
    }) as never,
  cloudflareOAuthResult: () =>
    ({
      updateOne: (filter: unknown, update: unknown) => {
        results.push({ filter, update })

        return Promise.resolve({ acknowledged: true })
      },
    }) as never,
})

const { persistSlackBinding } = await import('./slack-app')
const { persistCloudflareBinding } = await import('./cloudflare-app')
const { persistDiscordBinding } = await import('./discord-app')

afterEach(() => {
  results.length = 0
  slackUpdateError = null
})

describe('connector persist functions', () => {
  test('slack: a workspace claimed by another team mid-flow reports workspace_taken', async () => {
    slackUpdateError = Object.assign(new Error('dup'), { code: 11000 })

    const params = await persistSlackBinding(TEAM, {
      requesterUserId: 'alice',
      slackTeamId: 'T1',
      slackTeamName: 'Acme',
      botUserId: 'B1',
      encryptedBotToken: envelope as never,
      installerSlackUserId: null,
      scope: 'chat:write',
    })

    expect(params.error).toBe('workspace_taken')
  })

  test('cloudflare: rebinds in place and records the polling result', async () => {
    const params = await persistCloudflareBinding(TEAM, {
      state: 's1',
      accountId: 'acc1',
      accountName: 'Acme',
      oauth: {
        clientId: 'cid',
        scope: 'read',
        encryptedAccessToken: envelope as never,
        encryptedRefreshToken: null,
        accessTokenExpiresAt: null,
      },
    })

    expect(params).toEqual({
      binding_id: CF_BINDING.toHexString(),
      team_id: TEAM.toHexString(),
      account_id: 'acc1',
      account_name: 'Acme',
    })
    expect(results).toHaveLength(1)
    expect((results[0] as { filter: unknown }).filter).toEqual({ _id: 's1' })
  })

  test('discord: refuses a draft staged for another team', async () => {
    const params = await persistDiscordBinding(TEAM, {
      pending: {
        _id: 's1',
        operation: 'link',
        teamId: new ObjectId().toHexString(),
        requesterUserId: 'alice',
        expiresAt: new Date(Date.now() + 60_000),
      },
      discordUserId: 'd1',
    })

    expect(params).toEqual({ error: 'expired_state' })
  })
})
