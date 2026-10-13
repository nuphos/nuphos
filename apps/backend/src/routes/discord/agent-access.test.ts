import { describe, expect, test } from 'bun:test'

import { discordMessageView, reachableDiscordMessages, resolveDiscordChannel } from './agent-access'

import type { DiscordChannelScopeDependencies } from './agent-access'

const GUILD = '100000000000000001'
const CHANNEL = '200000000000000001'
const THREAD = '300000000000000001'

function dependencies(
  overrides: Partial<DiscordChannelScopeDependencies> = {},
): DiscordChannelScopeDependencies {
  return {
    findInstallation: async () => ({ guildId: GUILD }),
    getChannel: async (id) =>
      id === THREAD
        ? { id, type: 11, guild_id: GUILD, parent_id: CHANNEL }
        : { id, type: 0, guild_id: GUILD },
    isEnabled: async (_teamId, _guildId, channelId) => channelId === CHANNEL,
    ...overrides,
  }
}

const rejection = async (promise: Promise<unknown>) =>
  await promise.then(
    () => null,
    (err: { status?: number; code?: string }) => ({ status: err.status, code: err.code }),
  )

describe('Discord channel scope', () => {
  test('reaches an enabled channel and the threads under it', async () => {
    expect((await resolveDiscordChannel('team-1', CHANNEL, dependencies())).channel.id).toBe(
      CHANNEL,
    )
    expect((await resolveDiscordChannel('team-1', THREAD, dependencies())).channel.id).toBe(THREAD)
  })

  test('refuses a channel that is not enabled, missing, or in another server', async () => {
    const denied = { status: 403, code: 'discord_channel_not_enabled' }

    expect(
      await rejection(resolveDiscordChannel('team-1', '200000000000000002', dependencies())),
    ).toEqual(denied)
    expect(
      await rejection(
        resolveDiscordChannel(
          'team-1',
          CHANNEL,
          dependencies({
            getChannel: async () => {
              throw new Error('Unknown Channel')
            },
          }),
        ),
      ),
    ).toEqual(denied)
    expect(
      await rejection(
        resolveDiscordChannel(
          'team-1',
          CHANNEL,
          dependencies({
            getChannel: async (id) => ({ id, type: 0, guild_id: '100000000000000002' }),
          }),
        ),
      ),
    ).toEqual(denied)
  })

  test('refuses a private thread under an enabled channel', async () => {
    expect(
      await rejection(
        resolveDiscordChannel(
          'team-1',
          THREAD,
          dependencies({
            getChannel: async (id) => ({ id, type: 12, guild_id: GUILD, parent_id: CHANNEL }),
          }),
        ),
      ),
    ).toEqual({ status: 403, code: 'discord_channel_not_enabled' })
  })

  test('keeps search hits from enabled channels and their open threads only', () => {
    const message = (id: string, channelId: string) => ({
      id,
      channel_id: channelId,
      timestamp: '2026-01-01T00:00:00.000Z',
    })
    const hits = reachableDiscordMessages(
      {
        messages: [
          [message('1', CHANNEL)],
          [message('2', THREAD)],
          [message('3', '300000000000000002')],
          [message('4', '300000000000000003')],
          [message('5', '200000000000000002')],
        ],
        threads: [
          { id: THREAD, type: 11, parent_id: CHANNEL },
          { id: '300000000000000002', type: 12, parent_id: CHANNEL },
          { id: '300000000000000003', type: 11, parent_id: '200000000000000002' },
        ],
      },
      [CHANNEL],
    )

    expect(hits.map((hit) => hit.id)).toEqual(['1', '2'])
  })

  test('refuses before calling Discord when the id is not a snowflake or nothing is installed', async () => {
    const getChannel = async () => {
      throw new Error('must not be called')
    }

    expect(
      await rejection(resolveDiscordChannel('team-1', '../guilds/1', dependencies({ getChannel }))),
    ).toEqual({ status: 400, code: 'invalid_request' })
    expect(
      await rejection(
        resolveDiscordChannel(
          'team-1',
          CHANNEL,
          dependencies({ getChannel, findInstallation: async () => null }),
        ),
      ),
    ).toEqual({ status: 409, code: 'discord_not_installed' })
  })
})

describe('Discord message view', () => {
  test('keeps what an agent reads and drops empty collections', () => {
    expect(
      JSON.parse(
        JSON.stringify(
          discordMessageView({
            id: '1',
            channel_id: CHANNEL,
            content: 'deploy failed again',
            timestamp: '2026-01-01T00:00:00.000Z',
            author: { id: '9', username: 'ada', global_name: 'Ada' },
            attachments: [],
            embeds: [{ title: 'Alert', fields: [{ name: 'pod', value: 'api-1' }] }],
            message_reference: { message_id: '0' },
          }),
        ),
      ),
    ).toEqual({
      id: '1',
      channelId: CHANNEL,
      author: { id: '9', name: 'Ada' },
      content: 'deploy failed again',
      timestamp: '2026-01-01T00:00:00.000Z',
      replyTo: '0',
      embeds: [{ title: 'Alert', fields: [{ name: 'pod', value: 'api-1' }] }],
    })
  })
})
