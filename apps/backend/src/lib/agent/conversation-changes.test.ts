import { describe, expect, test } from 'bun:test'

import { MEMBERSHIP_RECHECK_MS, conversationChangesBody, relay } from './conversation-changes'

import type { ChangedConversation } from './conversation-changes'
import type { AgentConversation } from './db/shared'
import type { ChangeStreamDocument } from 'mongodb'

const TEAM = 'team-a'
const VIEWER = 'viewer'

/** One member's stream, with the changes it hears pushed by hand. */
function open(options: { isMember?: () => Promise<boolean>; clock?: { at: number } } = {}) {
  let listener: ((conversation: ChangedConversation) => void) | undefined
  let unsubscribed = false
  const clock = options.clock ?? { at: 0 }
  const body = conversationChangesBody({
    teamId: TEAM,
    viewerId: VIEWER,
    subscribe: (_team, next) => {
      listener = next

      return () => {
        unsubscribed = true
      }
    },
    isMember: options.isMember ?? (() => Promise.resolve(true)),
    heartbeatMs: 60_000,
    now: () => clock.at,
  })
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let done = false
  const pump = (async () => {
    for (;;) {
      const chunk = await reader.read()

      if (chunk.done) {
        done = true

        return
      }
      text += decoder.decode(chunk.value)
    }
  })()

  return {
    change: (conversation: Partial<ChangedConversation>) =>
      listener?.({ sessionId: 's', userId: 'owner', teamId: TEAM, ...conversation }),
    /** A database change, relayed as the replica's change stream relays it. */
    update: (
      conversation: Partial<ChangedConversation>,
      updatedFields: Partial<AgentConversation>,
      chats: ChangedConversation[] = [],
    ) =>
      relay(
        {
          fullDocument: { sessionId: 's', userId: 'owner', teamId: TEAM, ...conversation },
          updateDescription: { updatedFields },
        } as unknown as ChangeStreamDocument<AgentConversation>,
        (changed) => listener?.(changed),
        () => Promise.resolve(chats),
      ),
    settle: () => new Promise((resolve) => setTimeout(resolve, 5)),
    heard: () =>
      [...text.matchAll(/^data: (.+)$/gm)].map(
        (match) => JSON.parse(match[1]!).sessionId as string,
      ),
    ended: () => done,
    unsubscribed: () => unsubscribed,
    close: async () => {
      await reader.cancel()
      await pump
    },
  }
}

describe('conversation changes, as one member hears them', () => {
  test("another member's private Task is never heard of", async () => {
    const stream = open()

    stream.change({ sessionId: 'private-task', generalAccess: 'none' })
    await stream.settle()
    expect(stream.heard()).toEqual([])
    await stream.close()
  })

  test("another team's conversation is never heard of", async () => {
    const stream = open()

    stream.change({ sessionId: 'elsewhere', teamId: 'team-b', generalAccess: 'view' })
    await stream.settle()
    expect(stream.heard()).toEqual([])
    await stream.close()
  })

  test('what the member may read is heard of: theirs, shared with them, or with the team', async () => {
    const stream = open()

    stream.change({ sessionId: 'own', userId: VIEWER, generalAccess: 'none' })
    stream.change({ sessionId: 'invited', generalAccess: 'none', participantIds: [VIEWER] })
    stream.change({ sessionId: 'team-chat', kind: 'channel', generalAccess: 'reply' })
    await stream.settle()
    expect(stream.heard()).toEqual(['own', 'invited', 'team-chat'])
    await stream.close()
  })

  test('a chat made private after it was shared is no longer heard of', async () => {
    const stream = open()

    stream.change({ sessionId: 'chat', generalAccess: 'view' })
    stream.change({ sessionId: 'chat', generalAccess: 'none' })
    await stream.settle()
    expect(stream.heard()).toEqual(['chat'])
    await stream.close()
  })

  test('a member removed from the team hears nothing more within 30 s, and the stream ends', async () => {
    const clock = { at: 0 }
    let member = true
    const stream = open({ clock, isMember: () => Promise.resolve(member) })

    stream.change({ sessionId: 'before', generalAccess: 'view' })
    await stream.settle()
    member = false
    clock.at = MEMBERSHIP_RECHECK_MS
    stream.change({ sessionId: 'after', generalAccess: 'view' })
    await stream.settle()
    expect(stream.heard()).toEqual(['before'])
    expect(stream.ended()).toBe(true)
    expect(stream.unsubscribed()).toBe(true)
  })

  test('a membership check that fails ends the stream rather than keep sending', async () => {
    const clock = { at: 0 }
    const stream = open({ clock, isMember: () => Promise.reject(new Error('db down')) })

    clock.at = MEMBERSHIP_RECHECK_MS
    stream.change({ sessionId: 'chat', generalAccess: 'view' })
    await stream.settle()
    expect(stream.heard()).toEqual([])
    expect(stream.ended()).toBe(true)
  })

  describe("a Bot's name and face, shown in every chat it is in (#3933)", () => {
    // A teammate's private Bot, in a chat shared with the viewer.
    const bot = { sessionId: 'private-bot', generalAccess: 'none' } as const
    const chat: ChangedConversation = {
      sessionId: 'shared-chat',
      userId: 'owner',
      teamId: TEAM,
      kind: 'channel',
      generalAccess: 'none',
      participantIds: [VIEWER],
    }

    test('renaming it is heard as a change to the chat, though not to the Bot', async () => {
      const stream = open()

      stream.update(bot, { title: 'Renamed' }, [chat])
      await stream.settle()
      expect(stream.heard()).toEqual(['shared-chat'])
      await stream.close()
    })

    test('a new face is heard the same way', async () => {
      const stream = open()

      stream.update(bot, { avatar: '05-rembrandt' }, [chat])
      stream.update(bot, { avatarBackground: 'sky' }, [chat])
      await stream.settle()
      expect(stream.heard()).toEqual(['shared-chat', 'shared-chat'])
      await stream.close()
    })

    test("a chat the viewer can't read stays unheard of", async () => {
      const stream = open()

      stream.update(bot, { title: 'Renamed' }, [{ ...chat, participantIds: [] }])
      await stream.settle()
      expect(stream.heard()).toEqual([])
      await stream.close()
    })

    test('a change chats do not show, such as a new message, reaches no chat', async () => {
      const stream = open()

      stream.update({ sessionId: 'own-bot', userId: VIEWER }, { messageCount: 3 }, [chat])
      await stream.settle()
      expect(stream.heard()).toEqual(['own-bot'])
      await stream.close()
    })
  })
})
