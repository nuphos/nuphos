import { describe, expect, test } from 'bun:test'

import { JournalEventIdError, buildAuditEvent, deriveEventId } from './event'
import { GENESIS_PREV_HASH } from './types'

const SESSION = {
  conversationId: 'conv-1',
  requestId: 'req-1',
  streamId: 'stream-1',
  toolCallId: 'call-1',
  modelId: 'model-x',
}

const ACTOR = { userId: 'user-1', teamId: 'team-1' }

describe('deriveEventId', () => {
  test('tool call events key on conversation + request + toolCall (never attempt)', () => {
    expect(deriveEventId('tool_call_intent', SESSION)).toBe('tool_call_intent|conv-1|req-1|call-1')
    expect(deriveEventId('tool_call_result', SESSION)).toBe('tool_call_result|conv-1|req-1|call-1')
    expect(deriveEventId('user_approval', SESSION)).toBe('user_approval|conv-1|req-1|call-1')
  })

  test('message events key on messageId', () => {
    expect(deriveEventId('user_message', { conversationId: 'conv-1', messageId: 'msg-9' })).toBe(
      'user_message|conv-1|msg-9',
    )
  })

  test('client tool results key on carrying message + toolCall', () => {
    expect(
      deriveEventId('client_tool_result', {
        conversationId: 'conv-1',
        messageId: 'msg-9',
        toolCallId: 'call-7',
      }),
    ).toBe('client_tool_result|conv-1|msg-9|call-7')
  })

  test('turn and credential events key on requestId', () => {
    expect(deriveEventId('turn_start', SESSION)).toBe('turn_start|conv-1|req-1')
    expect(deriveEventId('credential_grant', SESSION)).toBe('credential_grant|conv-1|req-1')
  })

  test('retention events require an explicit qualifier', () => {
    expect(
      deriveEventId('conversation_retention_tombstone', {
        conversationId: 'conv-1',
        qualifier: 'retention-2026-07',
      }),
    ).toBe('conversation_retention_tombstone|conv-1|retention-2026-07')
  })

  test('missing components throw instead of producing ambiguous ids', () => {
    expect(() => deriveEventId('tool_call_intent', { conversationId: 'conv-1' })).toThrow(
      JournalEventIdError,
    )
    expect(() => deriveEventId('user_message', { conversationId: 'conv-1' })).toThrow(
      JournalEventIdError,
    )
  })
})

describe('buildAuditEvent golden vectors', () => {
  // Frozen forever — see canonical.test.ts for the policy.
  test('genesis event hashes deterministically', () => {
    const event = buildAuditEvent({
      eventId: 'tool_call_intent|conv-1|req-1|call-1',
      seq: 1,
      ts: '2026-07-02T09:00:00.000Z',
      type: 'tool_call_intent',
      actor: ACTOR,
      session: SESSION,
      payload: { toolName: 'bash', command: 'kubectl get pods -A' },
    })

    expect(event.prevHash).toBe(GENESIS_PREV_HASH)
    expect(event.payloadHash).toBe(
      'ba52879a65f80fe52db77d9df203b0f92f97afb1543ba615ee2e2e4a3c336cb8',
    )
    expect(event.entryHash).toBe('c7b980c9d56f13e062406f445fa931b46d85812f63ae5edca69895dd7c41479d')
  })

  test('chained event covers the previous entryHash', () => {
    const first = buildAuditEvent({
      eventId: 'tool_call_intent|conv-1|req-1|call-1',
      seq: 1,
      ts: '2026-07-02T09:00:00.000Z',
      type: 'tool_call_intent',
      actor: ACTOR,
      session: SESSION,
      payload: { toolName: 'bash', command: 'kubectl get pods -A' },
    })
    const second = buildAuditEvent({
      eventId: 'tool_call_result|conv-1|req-1|call-1',
      seq: 2,
      ts: '2026-07-02T09:00:05.000Z',
      type: 'tool_call_result',
      actor: ACTOR,
      session: SESSION,
      payload: { success: true, outputHash: first.payloadHash, outputBytes: 2048 },
      prevHash: first.entryHash,
    })

    expect(second.entryHash).toBe(
      '55986162c968ee204107b1175ce67220278ce312aea0c5c05395b29ac6b5c08c',
    )
  })

  test('any header change produces a different entryHash', () => {
    const base = {
      eventId: 'turn_start|conv-1|req-1',
      seq: 1,
      ts: '2026-07-02T09:00:00.000Z',
      type: 'turn_start' as const,
      actor: ACTOR,
      session: SESSION,
      payload: {},
    }
    const reference = buildAuditEvent(base)

    expect(buildAuditEvent({ ...base, seq: 2 }).entryHash).not.toBe(reference.entryHash)
    expect(buildAuditEvent({ ...base, ts: '2026-07-02T09:00:00.001Z' }).entryHash).not.toBe(
      reference.entryHash,
    )
    expect(buildAuditEvent({ ...base, payload: { a: 1 } }).entryHash).not.toBe(reference.entryHash)
    expect(buildAuditEvent({ ...base, actor: { ...ACTOR, teamId: null } }).entryHash).not.toBe(
      reference.entryHash,
    )
  })
})
