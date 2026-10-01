import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import { assertTriggerSlackDestinationAuthorized } from './trigger-slack-authorization'

import type { TriggerSlackAuthorizationDependencies } from './trigger-slack-authorization'

const teamId = new ObjectId().toHexString()
let channelLookups = 0
let selfLookups = 0

const dependencies: TriggerSlackAuthorizationDependencies = {
  getBinding: async () =>
    ({ slackTeamId: 'T1', slackTeamName: 'Acme' }) as Awaited<
      ReturnType<TriggerSlackAuthorizationDependencies['getBinding']>
    >,
  resolveBot: async () =>
    ({ botToken: 'secret', binding: { slackTeamId: 'T1' } }) as Awaited<
      ReturnType<TriggerSlackAuthorizationDependencies['resolveBot']>
    >,
  listChannelGrants: async () => [],
  resolveWorkspaceBot: async () => ({ botToken: 'grant-secret', workspaceName: 'Acme' }),
  getChannel: async (_token, channelId) => {
    channelLookups += 1

    return { id: channelId, name: 'ops', isPrivate: false }
  },
  getSelfMapping: async (input) => {
    selfLookups += 1

    return {
      slackWorkspaceId: input.slackWorkspaceId,
      slackUserId: 'U1',
      teamId: input.teamId,
      nuphosUserId: input.nuphosUserId,
      enabled: true,
      createdBy: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    }
  },
  getMembership: async () => ({ role: 'ADMINISTRATOR' }),
}

describe('trigger Slack destination authorization', () => {
  test('revalidates a joined channel before persisting it', async () => {
    channelLookups = 0
    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C1' },
        { teamId, userId: 'user-1' },
        dependencies,
      ),
    ).resolves.toBeUndefined()
    expect(channelLookups).toBe(1)
  })

  test('requires the current Nuphos user to have a Slack self mapping for DM', async () => {
    selfLookups = 0
    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'dm_self' },
        { teamId, userId: 'user-1' },
        dependencies,
      ),
    ).resolves.toBeUndefined()
    expect(selfLookups).toBe(1)

    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'dm_self' },
        { teamId, userId: 'user-1' },
        { ...dependencies, getSelfMapping: async () => null },
      ),
    ).rejects.toMatchObject({ code: 'slack_self_not_linked' } satisfies Partial<AppError>)
  })

  test('fails closed without the team installation or exact joined channel', async () => {
    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C1' },
        { userId: 'user-1' },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: 'slack_team_required' } satisfies Partial<AppError>)

    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C1' },
        { teamId, userId: 'user-1' },
        { ...dependencies, getBinding: async () => null },
      ),
    ).rejects.toMatchObject({ code: 'slack_not_connected' } satisfies Partial<AppError>)

    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C1' },
        { teamId, userId: 'user-1' },
        {
          ...dependencies,
          resolveBot: async () =>
            ({ botToken: 'secret', binding: { slackTeamId: 'OTHER' } }) as Awaited<
              ReturnType<TriggerSlackAuthorizationDependencies['resolveBot']>
            >,
        },
      ),
    ).rejects.toMatchObject({ code: 'slack_not_connected' } satisfies Partial<AppError>)

    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C1' },
        { teamId, userId: 'user-1' },
        {
          ...dependencies,
          getChannel: async () => ({ id: 'C2', name: 'other', isPrivate: false }),
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid_slack_destination' } satisfies Partial<AppError>)

    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'G1' },
        { teamId, userId: 'user-1' },
        {
          ...dependencies,
          getChannel: async () => ({ id: 'G1', name: 'private-ops', isPrivate: true }),
          getMembership: async () => ({ role: 'EDITOR' }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'private_slack_destination_forbidden',
    } satisfies Partial<AppError>)
  })

  test('authorizes a granted channel for a team without its own installation', async () => {
    const grantDependencies: TriggerSlackAuthorizationDependencies = {
      ...dependencies,
      getBinding: async () => null,
      listChannelGrants: async () => [{ slackWorkspaceId: 'T-OTHER', slackChannelId: 'C9' }],
    }

    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C9' },
        { teamId, userId: 'user-1' },
        grantDependencies,
      ),
    ).resolves.toBeUndefined()

    // Only the explicitly granted channels qualify.
    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C1' },
        { teamId, userId: 'user-1' },
        grantDependencies,
      ),
    ).rejects.toMatchObject({ code: 'slack_not_connected' } satisfies Partial<AppError>)

    // DM never rides a channel grant.
    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'dm_self' },
        { teamId, userId: 'user-1' },
        grantDependencies,
      ),
    ).rejects.toMatchObject({ code: 'slack_not_connected' } satisfies Partial<AppError>)

    // The granting workspace must still be installed.
    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C9' },
        { teamId, userId: 'user-1' },
        { ...grantDependencies, resolveWorkspaceBot: async () => null },
      ),
    ).rejects.toMatchObject({ code: 'slack_not_connected' } satisfies Partial<AppError>)

    // Private granted channels keep the administrator-only rule.
    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C9' },
        { teamId, userId: 'user-1' },
        {
          ...grantDependencies,
          getChannel: async () => ({ id: 'C9', name: 'private-ops', isPrivate: true }),
          getMembership: async () => ({ role: 'EDITOR' }),
        },
      ),
    ).rejects.toMatchObject({
      code: 'private_slack_destination_forbidden',
    } satisfies Partial<AppError>)
  })
})

describe('mixed access trigger destinations', () => {
  test('falls back to a channel grant when the own bot cannot reach the channel', async () => {
    const mixedDependencies: TriggerSlackAuthorizationDependencies = {
      ...dependencies,
      listChannelGrants: async () => [{ slackWorkspaceId: 'T-OTHER', slackChannelId: 'C9' }],
      getChannel: async (token, channelId) => {
        if (token === 'secret') {
          throw new AppError(400, 'slack_not_in_channel', 'Nuphos is not in that Slack channel')
        }

        return { id: channelId, name: 'shared-ops', isPrivate: false }
      },
    }

    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C9' },
        { teamId, userId: 'user-1' },
        mixedDependencies,
      ),
    ).resolves.toBeUndefined()

    // Without a matching grant the original unreachable-channel error stands.
    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C9' },
        { teamId, userId: 'user-1' },
        { ...mixedDependencies, listChannelGrants: async () => [] },
      ),
    ).rejects.toMatchObject({ code: 'slack_not_in_channel' } satisfies Partial<AppError>)
  })

  test('authorizes a workspace-qualified foreign destination through its grant only', async () => {
    const mixedDependencies: TriggerSlackAuthorizationDependencies = {
      ...dependencies,
      listChannelGrants: async () => [{ slackWorkspaceId: 'T-OTHER', slackChannelId: 'C9' }],
    }

    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C9', slackWorkspaceId: 'T-OTHER' },
        { teamId, userId: 'user-1' },
        mixedDependencies,
      ),
    ).resolves.toBeUndefined()

    await expect(
      assertTriggerSlackDestinationAuthorized(
        { type: 'channel', channelId: 'C9', slackWorkspaceId: 'T-UNRELATED' },
        { teamId, userId: 'user-1' },
        mixedDependencies,
      ),
    ).rejects.toMatchObject({ code: 'slack_not_connected' } satisfies Partial<AppError>)
  })
})
