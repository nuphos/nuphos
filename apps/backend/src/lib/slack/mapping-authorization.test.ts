import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import { assertChannelMappingCreationAllowed } from './mapping-authorization'

import type { ChannelMappingAuthorizationDependencies } from './mapping-authorization'

const teamId = new ObjectId().toHexString()
const ownerTeamId = new ObjectId().toHexString()

const dependencies: ChannelMappingAuthorizationDependencies = {
  getInstallationTeamId: async () => ownerTeamId,
  resolveWorkspaceBot: async () => ({ botToken: 'ws-token' }),
  getMembership: async () => null,
  getSelfSlackUserId: async () => 'U-CALLER',
  assertBotInChannel: async () => ({ id: 'C1' }),
  isChannelMember: async () => true,
  legacyBotConfigured: () => false,
}

const input = {
  teamId,
  userId: 'user-1',
  slackWorkspaceId: 'T-HOST',
  slackChannelId: 'C1',
}

describe('channel mapping creation authorization', () => {
  test('allows mapping a channel of the workspace the team itself installed', async () => {
    await expect(
      assertChannelMappingCreationAllowed(input, {
        ...dependencies,
        getInstallationTeamId: async () => teamId,
        // Nothing channel-side should even be consulted.
        assertBotInChannel: async () => {
          throw new Error('unexpected')
        },
      }),
    ).resolves.toBeUndefined()
  })

  test('rejects a workspace with no installation unless the legacy bot era applies', async () => {
    await expect(
      assertChannelMappingCreationAllowed(input, {
        ...dependencies,
        getInstallationTeamId: async () => null,
      }),
    ).rejects.toMatchObject({ code: 'slack_workspace_not_installed' } satisfies Partial<AppError>)

    await expect(
      assertChannelMappingCreationAllowed(input, {
        ...dependencies,
        getInstallationTeamId: async () => null,
        legacyBotConfigured: () => true,
      }),
    ).resolves.toBeUndefined()
  })

  test('allows an administrator of the installing team to grant outward', async () => {
    await expect(
      assertChannelMappingCreationAllowed(input, {
        ...dependencies,
        getMembership: async (_userId, membershipTeamId) =>
          membershipTeamId === ownerTeamId ? { role: 'ADMINISTRATOR' } : null,
        assertBotInChannel: async () => {
          throw new Error('unexpected')
        },
      }),
    ).resolves.toBeUndefined()
  })

  test('allows a caller whose linked Slack identity is in the channel', async () => {
    let membershipChecked: string | null = null

    await expect(
      assertChannelMappingCreationAllowed(input, {
        ...dependencies,
        isChannelMember: async (_token, _channelId, slackUserId) => {
          membershipChecked = slackUserId

          return true
        },
      }),
    ).resolves.toBeUndefined()
    expect(membershipChecked as string | null).toBe('U-CALLER')
  })

  test('rejects cross-team mappings without channel-side proof', async () => {
    await expect(
      assertChannelMappingCreationAllowed(input, {
        ...dependencies,
        isChannelMember: async () => false,
      }),
    ).rejects.toMatchObject({
      code: 'slack_channel_membership_required',
    } satisfies Partial<AppError>)

    await expect(
      assertChannelMappingCreationAllowed(input, {
        ...dependencies,
        getSelfSlackUserId: async () => null,
      }),
    ).rejects.toMatchObject({
      code: 'slack_channel_membership_required',
    } satisfies Partial<AppError>)

    // The bot itself must be able to reach the channel to verify anything.
    await expect(
      assertChannelMappingCreationAllowed(input, {
        ...dependencies,
        assertBotInChannel: async () => {
          throw new AppError(400, 'slack_not_in_channel', 'Nuphos is not in that Slack channel')
        },
      }),
    ).rejects.toMatchObject({ code: 'slack_not_in_channel' } satisfies Partial<AppError>)
  })
})
