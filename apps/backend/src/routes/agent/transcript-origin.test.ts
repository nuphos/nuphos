import { describe, expect, test } from 'bun:test'

import type { UIMessage } from 'ai'

import { buildSlackMessageOrigin } from '@/lib/agent/message-origin'
import { normalizeTranscriptMessages, uiMessagesToTranscript } from '@/routes/agent/transcript'

const ORIGIN = buildSlackMessageOrigin({
  workspaceId: 'T123ABC',
  channelId: 'C456DEF',
  threadTs: '1712000000.000100',
  userId: 'U789GHI',
})

// F1 (review round 1): uiMessagesToTranscript carries origin through, but the
// client-facing transcript-sync endpoint's normalizer dropped it. Harmless
// while no client sends one — and a silent hole the moment any resync flow
// touches a Slack-originated conversation.
describe('normalizeTranscriptMessages — message origin', () => {
  test('carries a valid origin through', () => {
    const [message] = normalizeTranscriptMessages([
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }], origin: ORIGIN },
    ])

    expect(message!.origin).toEqual(ORIGIN!)
  })

  test('omits origin when the client sent none', () => {
    const [message] = normalizeTranscriptMessages([
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
    ])

    expect(message!.origin).toBeUndefined()
  })

  // The endpoint is client-facing, so the shape is validated rather than
  // trusted — the same treatment the metadata path already gets.
  test('drops a malformed or foreign origin instead of storing it', () => {
    const [foreign] = normalizeTranscriptMessages([
      { id: 'm1', role: 'user', parts: [], origin: { surface: 'teams', channelId: 'C1' } },
    ])
    const [junk] = normalizeTranscriptMessages([
      { id: 'm2', role: 'user', parts: [], origin: 'slack' },
    ])

    expect(foreign!.origin).toBeUndefined()
    expect(junk!.origin).toBeUndefined()
  })
})

describe('uiMessagesToTranscript — message origin', () => {
  test('reads origin off UIMessage metadata', () => {
    const [message] = uiMessagesToTranscript([
      {
        id: 'm1',
        role: 'user',
        metadata: { origin: ORIGIN },
        parts: [{ type: 'text', text: 'hi' }],
      } as unknown as UIMessage,
    ])

    expect(message!.origin).toEqual(ORIGIN!)
  })

  test('carries an autonomous turn boundary through UI message metadata', () => {
    const [message] = uiMessagesToTranscript([
      {
        id: 'a1',
        role: 'assistant',
        metadata: { turnOrigin: 'autonomous' },
        parts: [{ type: 'text', text: 'Timer fired' }],
      } as unknown as UIMessage,
    ])

    expect(message!.turnOrigin).toBe('autonomous')
  })

  test('keeps tool timing metadata through transcript normalization', () => {
    const [message] = uiMessagesToTranscript([
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-Terminal',
            toolCallId: 'tool-1',
            state: 'output-available',
            input: { command: 'echo ok' },
            output: 'ok',
            startedAt: 1_000,
            completedAt: 4_250,
          },
        ],
      } as unknown as UIMessage,
    ])

    expect(message!.parts[0]).toMatchObject({ startedAt: 1_000, completedAt: 4_250 })
  })
})

describe('normalizeTranscriptMessages — turn origin', () => {
  test('accepts only the autonomous marker', () => {
    const [autonomous, forged] = normalizeTranscriptMessages([
      { id: 'a1', role: 'assistant', parts: [], turnOrigin: 'autonomous' },
      { id: 'a2', role: 'assistant', parts: [], turnOrigin: 'interactive' },
    ])

    expect(autonomous!.turnOrigin).toBe('autonomous')
    expect(forged!.turnOrigin).toBeUndefined()
  })
})

describe('turn kind', () => {
  test('a plan-approval tag rides UI metadata into the transcript', () => {
    const [tagged, typed] = uiMessagesToTranscript([
      {
        id: 'u1',
        role: 'user',
        metadata: { turnKind: 'plan-approval' },
        parts: [{ type: 'text', text: 'Approved plan #4 — please proceed with plan #4.' }],
      } as unknown as UIMessage,
      {
        id: 'u2',
        role: 'user',
        parts: [{ type: 'text', text: 'Approved plan #4 — please proceed with plan #4.' }],
      } as unknown as UIMessage,
    ])

    expect(tagged!.turnKind).toBe('plan-approval')
    expect(typed!.turnKind).toBeUndefined()
  })

  test('the transcript sync accepts only the plan-approval kind', () => {
    const [kept, forged] = normalizeTranscriptMessages([
      { id: 'u1', role: 'user', parts: [], turnKind: 'plan-approval' },
      { id: 'u2', role: 'user', parts: [], turnKind: 'other' },
    ])

    expect(kept!.turnKind).toBe('plan-approval')
    expect(forged!.turnKind).toBeUndefined()
  })
})

test('verified attribution survives persistence but client sync cannot inject it', () => {
  const metadata = {
    version: 1 as const,
    sender: { type: 'user' as const, id: 'u1', displayName: 'Yuan' },
    source: 'nuphos' as const,
    sentAt: '2026-09-27T10:00:00Z',
  }
  const message = {
    id: 'm1',
    role: 'user',
    parts: [{ type: 'text', text: 'hello' }],
    metadata,
  } as UIMessage

  expect(uiMessagesToTranscript([message])[0]?.metadata).toEqual(metadata)
  expect(normalizeTranscriptMessages([message])[0]?.metadata).toBeUndefined()
})
