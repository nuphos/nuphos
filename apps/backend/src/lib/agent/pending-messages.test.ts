// Redis is disabled in the test env, which exercises the single-process path
// (the local map). The Redis path is the same contract expressed in RPUSH /
// LTRIM / an atomic LRANGE+DEL.
import { beforeEach, describe, expect, test } from 'bun:test'

import {
  PENDING_TTL_SEC,
  buildPendingUserMessage,
  clearPendingUserMessages,
  drainPendingUserMessages,
  enqueuePendingUserMessage,
  hasPendingUserMessages,
  renderInjectedUserMessages,
} from './pending-messages'
import { OPENAB_PERMISSION_DECISION_TIMEOUT_MS } from '../claude-code-preview/openab-permission-bridge'

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

  test('accepted messages outlive the longest human tool-approval wait', () => {
    expect(PENDING_TTL_SEC * 1_000).toBeGreaterThan(OPENAB_PERMISSION_DECISION_TIMEOUT_MS)
  })

  test('a full queue refuses the newest message instead of evicting an acknowledged one', async () => {
    const outcomes: boolean[] = []

    for (let i = 0; i < 15; i++) outcomes.push(await enqueue(`message ${String(i)}`))

    const drained = await drainPendingUserMessages(USER, SESSION)

    expect(drained).toHaveLength(10)
    expect(drained[0]!.renderedText).toBe('message 0')
    expect(drained.at(-1)!.renderedText).toBe('message 9')
    expect(outcomes).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ])
  })
})

describe('renderInjectedUserMessages', () => {
  test('carries no synthetic-continuation prefix — this is a real user turn', () => {
    const rendered = renderInjectedUserMessages([
      buildPendingUserMessage({ renderedText: 'actually, staging', source: 'slack' }),
    ])

    expect(rendered).not.toContain('[automatic continuation')
    expect(rendered).toContain('actually, staging')
    expect(rendered).toContain('while you were still working')
  })

  test('offers all three responses instead of dictating one', () => {
    const rendered = renderInjectedUserMessages([
      buildPendingUserMessage({ renderedText: 'wait', source: 'slack' }),
    ])

    expect(rendered).toContain('carry on')
    expect(rendered).toContain('redirect or cancel')
    expect(rendered).toContain('Do not restart from scratch')
  })

  test('keeps several messages distinguishable', () => {
    const rendered = renderInjectedUserMessages([
      buildPendingUserMessage({ renderedText: 'one', source: 'slack' }),
      buildPendingUserMessage({ renderedText: 'two', source: 'slack' }),
    ])

    expect(rendered).toContain('these messages')
    expect(rendered).toContain('one')
    expect(rendered).toContain('two')
  })
})
