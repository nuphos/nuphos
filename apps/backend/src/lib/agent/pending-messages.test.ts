// Redis is disabled in the test env, which exercises the single-process path
// (the local map). The Redis path is the same contract expressed in RPUSH /
// LTRIM / an atomic LRANGE+DEL.
import { beforeEach, describe, expect, test } from 'bun:test'

import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  drainPendingUserMessages,
  enqueuePendingUserMessage,
  hasPendingUserMessages,
  renderInjectedUserMessages,
} from './pending-messages'

const USER = 'user-1'
const SESSION = 'session-1'

async function enqueue(text: string): Promise<boolean> {
  return await enqueuePendingUserMessage(
    USER,
    SESSION,
    buildPendingUserMessage({ renderedText: text, source: 'slack' }),
  )
}

beforeEach(async () => {
  await clearPendingUserMessages(USER, SESSION)
})

describe('pending user messages', () => {
  test('a drained queue returns the messages in the order they were sent', async () => {
    await enqueue('first')
    await enqueue('second')

    const drained = await drainPendingUserMessages(USER, SESSION)

    expect(drained.map((message) => message.renderedText)).toEqual(['first', 'second'])
  })

  test('draining empties the queue, so two drains cannot deliver the same message twice', async () => {
    await enqueue('only once')

    expect(await drainPendingUserMessages(USER, SESSION)).toHaveLength(1)
    expect(await drainPendingUserMessages(USER, SESSION)).toHaveLength(0)
  })

  test('hasPending reflects the queue without consuming it', async () => {
    expect(await hasPendingUserMessages(USER, SESSION)).toBe(false)
    await enqueue('waiting')
    expect(await hasPendingUserMessages(USER, SESSION)).toBe(true)
    expect(await hasPendingUserMessages(USER, SESSION)).toBe(true)
    expect(await drainPendingUserMessages(USER, SESSION)).toHaveLength(1)
  })

  test('queues are per session', async () => {
    await enqueue('for session 1')
    expect(await drainPendingUserMessages(USER, 'session-2')).toHaveLength(0)
    expect(await drainPendingUserMessages(USER, SESSION)).toHaveLength(1)
  })

  test('an actor drain cannot consume another teammate instruction', async () => {
    await enqueuePendingUserMessage(
      USER,
      SESSION,
      buildPendingUserMessage({
        renderedText: 'from A',
        source: 'slack',
        actorUserId: 'actor-a',
      }),
    )
    await enqueuePendingUserMessage(
      USER,
      SESSION,
      buildPendingUserMessage({
        renderedText: 'from B',
        source: 'slack',
        actorUserId: 'actor-b',
      }),
    )

    expect(
      (await drainPendingUserMessages(USER, SESSION, 'actor-a')).map(
        (message) => message.renderedText,
      ),
    ).toEqual(['from A'])
    expect(
      (await drainPendingUserMessages(USER, SESSION, 'actor-b')).map(
        (message) => message.renderedText,
      ),
    ).toEqual(['from B'])
  })

  test('an identical wake-up takes no slot; distinct events and resources keep one each', async () => {
    const wake = (pr: number, text: string) => {
      const message = buildPendingUserMessage({
        renderedText: text,
        source: 'agent.resource',
        metadata: {
          version: 1,
          sender: { type: 'system', id: 'github', displayName: 'GitHub' },
          source: 'agent.resource',
          resourceUrl: `https://github.com/o/r/pull/${String(pr)}`,
          sentAt: new Date().toISOString(),
        },
      })

      return { message, queued: enqueuePendingUserMessage(USER, SESSION, message) }
    }
    const first = wake(1, 'GitHub check_suite.completed.')

    expect(await first.queued).toBe(true)
    await enqueue('from a person')
    for (let i = 0; i < 30; i++)
      expect(await wake(1, 'GitHub check_suite.completed.').queued).toBe(true)
    expect(await wake(1, 'GitHub pull_request_review.submitted.').queued).toBe(true)
    expect(await wake(2, 'GitHub check_suite.completed.').queued).toBe(true)

    const drained = await drainPendingUserMessages(USER, SESSION)

    expect(drained.map((m) => m.renderedText)).toEqual([
      'GitHub check_suite.completed.',
      'from a person',
      'GitHub pull_request_review.submitted.',
      'GitHub check_suite.completed.',
    ])
    // The parked wake-up keeps the id that was already acknowledged.
    expect(drained[0]!.id).toBe(first.message.id)
  })

  test('a queue has no cap: every accepted message waits, in order', async () => {
    const outcomes: boolean[] = []

    for (let i = 0; i < 25; i++) outcomes.push(await enqueue(`message ${String(i)}`))

    const drained = await drainPendingUserMessages(USER, SESSION)

    expect(outcomes.every(Boolean)).toBe(true)
    expect(drained.map((message) => message.renderedText)).toEqual(
      Array.from({ length: 25 }, (_, i) => `message ${String(i)}`),
    )
  })
})

describe('renderInjectedUserMessages', () => {
  test('keeps each waiting message, separated, with no framing about who sent it', () => {
    const rendered = renderInjectedUserMessages([
      buildPendingUserMessage({ renderedText: 'one', source: 'slack' }),
      buildPendingUserMessage({ renderedText: 'two', source: 'slack' }),
    ])

    expect(rendered).toBe('one\n\n---\n\ntwo')
  })
})
