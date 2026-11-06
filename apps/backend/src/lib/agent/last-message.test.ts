import { beforeEach, describe, expect, test } from 'bun:test'

import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { agentMessages } from './db'
import { lastMessage } from './last-message'

import type * as dbActual from '@/lib/db'

let memory = portabilityDb()

useDb({ db: () => memory })

const chat = { sessionId: 'chat', userId: 'me' }
const channel = { ...chat, kind: 'channel' }

async function post(
  parts: unknown[],
  sender?: { type: 'user' | 'agent'; id: string; name: string },
) {
  await agentMessages().insertOne({
    ...chat,
    index: 0,
    parts,
    ...(sender
      ? {
          metadata: {
            version: 1,
            sender: { type: sender.type, id: sender.id, displayName: sender.name },
            source: sender.type === 'user' ? 'nuphos' : 'agent.thread',
            ...(sender.type === 'agent' ? { sourceSessionId: sender.id } : {}),
            sentAt: new Date().toISOString(),
          },
        }
      : {}),
  } as never)
}

describe('lastMessage', () => {
  beforeEach(() => {
    memory = portabilityDb()
  })

  test('an empty chat has none', async () => {
    expect(await lastMessage(chat, 'me')).toBeUndefined()
  })

  test("an agent's reply previews its last text, not its tool calls", async () => {
    await post([
      { type: 'text', text: 'Checking.' },
      { type: 'tool-bash', output: 'x'.repeat(1000) },
      { type: 'text', text: '**Done**, all green.' },
    ])

    expect(await lastMessage(chat, 'me')).toEqual({ text: '**Done**, all green.' })
  })

  test('a file-only message has empty text', async () => {
    await post([{ type: 'transfer-upload', groupId: 'g', files: [] }])

    expect(await lastMessage(chat, 'me')).toEqual({ text: '' })
  })

  test('a tool-only message falls back to the newest one with text', async () => {
    // The test store ignores sort, so posts go in newest first.
    await post([{ type: 'tool-bash' }])
    await post([{ type: 'text', text: 'Working on it.' }])

    expect(await lastMessage(chat, 'me')).toEqual({ text: 'Working on it.' })
  })

  test('a group chat names a person by first name and an agent by its title', async () => {
    await post([{ type: 'text', text: 'hi' }], { type: 'user', id: 'ann', name: 'Ann Lee' })
    expect(await lastMessage(channel, 'me')).toEqual({ text: 'hi', from: 'Ann' })

    memory = portabilityDb()
    await post([{ type: 'text', text: 'ok' }], { type: 'agent', id: 'a1', name: 'Code Reviewer' })
    expect(await lastMessage(channel, 'me')).toEqual({ text: 'ok', from: 'Code Reviewer' })
  })

  test("the viewer's own post and a 1:1 chat carry no sender", async () => {
    await post([{ type: 'text', text: 'hi' }], { type: 'user', id: 'me', name: 'Me' })
    expect(await lastMessage(channel, 'me')).toEqual({ text: 'hi' })
    expect(await lastMessage(chat, 'ann')).toEqual({ text: 'hi' })
  })

  test('long text is cut short', async () => {
    await post([{ type: 'text', text: 'a'.repeat(1000) }])

    expect((await lastMessage(chat, 'me'))?.text).toHaveLength(300)
  })
})
