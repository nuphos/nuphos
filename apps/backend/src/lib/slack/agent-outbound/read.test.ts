import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useSlackApi } from '@/lib/test/doubles/slack-api'

import type { SlackOutboundContext, SlackOutboundDependencies } from '@/lib/slack/agent-outbound'

const downloads: { token: string; url: string }[] = []

useSlackApi({
  downloadSlackFile: (args: { token: string; urlPrivate: string }) => {
    downloads.push({ token: args.token, url: args.urlPrivate })

    return Promise.resolve({ bytes: new Uint8Array([137, 80, 78, 71]), contentType: 'image/png' })
  },
})

const { createSlackOutboundContext } = await import('@/lib/slack/agent-outbound')
const teamId = new ObjectId().toHexString()
let installed = true
let admin = true
let channelGrants: { slackWorkspaceId: string; slackChannelId: string }[] = []
let channels: Record<string, { isPrivate: boolean; joined: boolean }> = {}
const reads: { method: string; token: string; input: Record<string, unknown> }[] = []

const dependencies = {
  getBinding: async () => (installed ? { slackTeamId: 'T1', slackTeamName: 'Acme' } : null),
  resolveBot: async () =>
    installed ? { botToken: 'own-token', binding: { slackTeamId: 'T1' } } : null,
  listChannelGrants: async () => channelGrants,
  resolveWorkspaceBot: async () => ({ botToken: 'grant-token', workspaceName: 'HostCo' }),
  canViewPrivateChannels: async () => admin,
  getChannel: async (_token: string, channelId: string) => {
    const channel = channels[channelId]

    if (!channel?.joined) throw new Error('Nuphos is not in that Slack channel.')

    return { id: channelId, name: `name-${channelId}`, isPrivate: channel.isPrivate }
  },
  readHistory: async ({ token, ...input }) => {
    reads.push({ method: 'history', token, input })

    return { messages: page, hasMore: true, nextCursor: 'next' }
  },
  readReplies: async ({ token, ...input }) => {
    reads.push({ method: 'replies', token, input })

    return { messages: [{ ts: '1.0' }, { ts: '1.5' }], hasMore: false }
  },
  listMembers: async ({ token, ...input }) => {
    reads.push({ method: 'members', token, input })

    return { members: people, truncated: false }
  },
} as Partial<SlackOutboundDependencies> as SlackOutboundDependencies

const person = (id: string, name: string, realName: string) => ({
  id,
  name,
  displayName: name,
  realName,
  isBot: false,
})
let page: Record<string, unknown>[] = [{ ts: '2.0' }, { ts: '1.0' }]
let people = [person('U1', 'ada', 'Ada Lovelace'), person('U2', 'grace', 'Grace Hopper')]

const placed: { fileName: string; bytes: number }[][] = []

async function context() {
  return (await createSlackOutboundContext(
    {
      userId: 'user-1',
      teamId,
      sessionId: 'conv-1',
      placeFiles: (files) => {
        placed.push(files.map((file) => ({ fileName: file.fileName, bytes: file.bytes.length })))

        return Promise.resolve(files.map((file) => `/runtime/${file.fileName}`))
      },
    },
    dependencies,
  ))!
}

async function read(input: Parameters<SlackOutboundContext['read']>[0]) {
  return await (await context()).read(input)
}

async function members(input: Parameters<SlackOutboundContext['members']>[0]) {
  return await (await context()).members(input)
}

beforeEach(() => {
  installed = true
  admin = true
  channelGrants = []
  channels = { C1: { isPrivate: false, joined: true } }
  reads.length = 0
  downloads.length = 0
  placed.length = 0
  page = [{ ts: '2.0' }, { ts: '1.0' }]
  people = [person('U1', 'ada', 'Ada Lovelace'), person('U2', 'grace', 'Grace Hopper')]
})

describe('slack read', () => {
  test('reads a joined channel’s top-level messages with the team’s own bot', async () => {
    const result = await read({ channelId: 'C1', limit: 5, latest: '3.0' })

    expect(result).toEqual({
      ok: true,
      channel: { id: 'C1', name: 'name-C1' },
      messages: [{ ts: '2.0' }, { ts: '1.0' }],
      hasMore: true,
      nextCursor: 'next',
    })
    expect(reads).toEqual([
      { method: 'history', token: 'own-token', input: { channel: 'C1', limit: 5, latest: '3.0' } },
    ])
  })

  test('reads one thread’s replies when threadTs is given', async () => {
    const result = await read({ channelId: 'C1', threadTs: '1.0', limit: 50 })

    expect(result).toMatchObject({ ok: true, messages: [{ ts: '1.0' }, { ts: '1.5' }] })
    expect(reads).toEqual([
      {
        method: 'replies',
        token: 'own-token',
        input: { channel: 'C1', threadTs: '1.0', maxMessages: 50 },
      },
    ])
  })

  test('with files, puts a message’s attachments on the runtime and drops the Slack URLs', async () => {
    const screenshot = {
      id: 'F1',
      name: 'screenshot.png',
      mimetype: 'image/png',
      url_private: 'https://files.slack.com/files-pri/T1-F1/screenshot.png',
      url_private_download: 'https://files.slack.com/files-pri/T1-F1/download/screenshot.png',
    }

    page = [{ ts: '2.0', text: 'See the error', files: [screenshot] }]

    // Without files the page is as Slack sent it, and nothing is downloaded.
    expect(await read({ channelId: 'C1' })).toMatchObject({ messages: [{ files: [screenshot] }] })
    expect(downloads).toEqual([])

    const result = await read({ channelId: 'C1', files: true })

    expect(result).toMatchObject({
      ok: true,
      messages: [
        {
          ts: '2.0',
          files: [{ id: 'F1', name: 'screenshot.png', path: '/runtime/screenshot.png' }],
        },
      ],
      note: expect.stringContaining('untrusted data'),
    })
    expect(JSON.stringify(result)).not.toContain('files.slack.com')
    // The bot token that read the channel fetched the file, inside the backend.
    expect(downloads).toEqual([{ token: 'own-token', url: screenshot.url_private }])
    expect(placed).toEqual([[{ fileName: 'screenshot.png', bytes: 4 }]])
  })

  test('refuses a channel the bot has not joined', async () => {
    const result = await read({ channelId: 'C9' })

    expect(result).toEqual({ ok: false, error: 'Nuphos is not in that Slack channel.' })
    expect(reads).toEqual([])
  })

  test('refuses a private channel to a member who is not an administrator', async () => {
    channels.P1 = { isPrivate: true, joined: true }
    admin = false

    expect(await read({ channelId: 'P1' })).toEqual({
      ok: false,
      error: 'Only a team administrator can read a private Slack channel.',
    })
    expect(reads).toEqual([])

    admin = true
    expect(await read({ channelId: 'P1' })).toMatchObject({ ok: true })
  })

  test('without its own installation, a team reads only the channels linked to it', async () => {
    installed = false
    channelGrants = [{ slackWorkspaceId: 'T2', slackChannelId: 'C1' }]
    channels.C2 = { isPrivate: false, joined: true }

    expect(await read({ channelId: 'C2' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('not linked to this Nuphos team'),
    })
    expect(await read({ channelId: 'C1' })).toMatchObject({ ok: true })
    expect(reads.map((entry) => entry.token)).toEqual(['grant-token'])
  })
})

describe('slack members', () => {
  test('lists a joined channel’s members, or those a query matches by any name', async () => {
    expect(await members({ channelId: 'C1' })).toEqual({
      ok: true,
      channel: { id: 'C1', name: 'name-C1' },
      members: people,
      truncated: false,
    })
    expect(reads).toEqual([{ method: 'members', token: 'own-token', input: { channel: 'C1' } }])
    expect(await members({ channelId: 'C1', query: 'HOPPER' })).toMatchObject({
      members: [{ id: 'U2' }],
    })
  })

  test('returns at most 200 and says the rest were left out', async () => {
    people = Array.from({ length: 201 }, (_, i) => person(`U${String(i)}`, `p${String(i)}`, ''))

    const result = await members({ channelId: 'C1' })

    expect(result).toMatchObject({ ok: true, truncated: true })
    expect(result.ok && result.members.length).toBe(200)
  })

  test('is closed where slack_read is: an unjoined channel, or a private one to a non-admin', async () => {
    channels.P1 = { isPrivate: true, joined: true }
    admin = false

    expect(await members({ channelId: 'C9' })).toEqual({
      ok: false,
      error: 'Nuphos is not in that Slack channel.',
    })
    expect(await members({ channelId: 'P1' })).toEqual({
      ok: false,
      error: 'Only a team administrator can read a private Slack channel.',
    })
    expect(reads).toEqual([])
  })
})
