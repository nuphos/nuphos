import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  formatJournalClock,
  formatRelativeJournalTs,
  groupJournalEvents,
  journalReasoningText,
  parseToolOutputPreview,
  reasoningByToolCall,
} from './journalEvent.ts'

import type { AgentJournalEvent } from '../api.ts'

// Run with: pnpm test  (node --experimental-strip-types --test; Node >= 22.6)

let seq = 0

function event(p: Partial<AgentJournalEvent> & { type: string }): AgentJournalEvent {
  seq += 1

  return {
    eventId: `evt-${seq}`,
    seq,
    ts: `2026-07-06T00:00:${String(seq).padStart(2, '0')}.000Z`,
    session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: null },
    payload: {},
    ...p,
  } as AgentJournalEvent
}

test('formatRelativeJournalTs: seconds, minutes, hours', () => {
  const base = '2026-07-06T00:00:00.000Z'

  assert.equal(formatRelativeJournalTs('2026-07-06T00:00:26.000Z', base), '+26s')
  assert.equal(formatRelativeJournalTs('2026-07-06T00:02:14.000Z', base), '+2m14s')
  assert.equal(formatRelativeJournalTs('2026-07-06T01:03:00.000Z', base), '+1h03m')
  // Clock skew never renders a negative offset.
  assert.equal(formatRelativeJournalTs(base, '2026-07-06T00:00:05.000Z'), '+0s')
  assert.equal(formatRelativeJournalTs('garbage', base), '')
})

test('formatJournalClock: fixed HH:MM:SS shape; invalid input renders empty', () => {
  // The rendered value is timezone-dependent; the column-alignment contract
  // is the SHAPE (24h, zero-padded, no locale decorations).
  assert.match(formatJournalClock('2026-07-06T08:16:10.000Z'), /^\d{2}:\d{2}:\d{2}$/)
  assert.equal(formatJournalClock('garbage'), '')
  assert.equal(formatJournalClock(''), '')
})

test('parseToolOutputPreview: bash JSON shape parses; truncated preview falls back to raw', () => {
  const parsed = parseToolOutputPreview({
    outputPreview: '{"exitCode":1,"stderr":"boom","stdout":"partial"}',
  })

  assert.equal(parsed.exitCode, 1)
  assert.equal(parsed.stderr, 'boom')
  assert.equal(parsed.stdout, 'partial')

  const truncated = parseToolOutputPreview({ outputPreview: '{"exitCode":0,"stdout":"cut of' })

  assert.equal(truncated.exitCode, null)
  assert.equal(truncated.raw, '{"exitCode":0,"stdout":"cut of')
})

test('journalReasoningText: extracts reasoning parts only', () => {
  const contentHot = [
    { type: 'reasoning', text: 'user wants zone count' },
    { type: 'text', text: 'Checking Cloudflare…' },
  ]

  assert.equal(journalReasoningText(contentHot), 'user wants zone count')
  assert.equal(journalReasoningText([{ type: 'text', text: 'hi' }]), '')
  assert.equal(journalReasoningText(undefined), '')
})

test('groupJournalEvents: intent/result pair by toolCallId; turn_end elided', () => {
  seq = 0
  const events = [
    event({ type: 'turn_start' }),
    event({ type: 'user_message' }),
    event({
      type: 'tool_call_intent',
      session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: 'call-1' },
    }),
    event({
      type: 'tool_call_result',
      session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: 'call-1' },
    }),
    event({ type: 'assistant_message' }),
    event({ type: 'turn_end' }),
  ] as AgentJournalEvent[]
  const items = groupJournalEvents(events)

  assert.deepEqual(
    items.map((item) => item.kind),
    ['turn', 'message', 'tool', 'message'],
  )
  const tool = items[2]!

  assert.equal(tool.kind, 'tool')
  if (tool.kind === 'tool') {
    assert.equal(tool.intent?.type, 'tool_call_intent')
    assert.equal(tool.result?.type, 'tool_call_result')
    assert.equal(tool.mayBeRunning, false)
  }
})

test('groupJournalEvents: trailing intent is "may be running"; earlier orphan is not', () => {
  seq = 0
  const events = [
    event({
      type: 'tool_call_intent',
      session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: 'dead' },
    }),
    event({ type: 'assistant_message' }),
    event({
      type: 'tool_call_intent',
      session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: 'live' },
    }),
  ] as AgentJournalEvent[]
  const items = groupJournalEvents(events)
  const [dead, , live] = items

  assert.equal(dead!.kind, 'tool')
  assert.equal(live!.kind, 'tool')
  if (dead!.kind === 'tool' && live!.kind === 'tool') {
    // Orphaned mid-stream intent = rejected/interrupted (the audit signal).
    assert.equal(dead!.result, null)
    assert.equal(dead!.mayBeRunning, false)
    // Newest event being an intent just means the tool hasn't finished yet.
    assert.equal(live!.mayBeRunning, true)
  }
})

test('groupJournalEvents: truncated pages never claim running or rejected', () => {
  seq = 0
  const events = [
    event({
      type: 'tool_call_intent',
      session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: 'a' },
    }),
    event({
      type: 'tool_call_result',
      session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: 'a' },
    }),
    event({
      type: 'tool_call_intent',
      session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: 'b' },
    }),
  ] as AgentJournalEvent[]
  const [paired, orphan] = groupJournalEvents(events, { truncated: true })

  if (paired!.kind === 'tool') {
    // A result inside the page settles the outcome regardless of truncation.
    assert.equal(paired!.tailTruncated, false)
  }
  if (orphan!.kind === 'tool') {
    // The result may simply be beyond the cut — neither running… nor the
    // rejected/interrupted warning would be an honest claim.
    assert.equal(orphan!.mayBeRunning, false)
    assert.equal(orphan!.tailTruncated, true)
  }
})

test('groupJournalEvents: result without intent renders standalone; client results pair too', () => {
  seq = 0
  const events = [
    event({
      type: 'client_tool_result',
      session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: 'orphan' },
    }),
  ] as AgentJournalEvent[]
  const items = groupJournalEvents(events)

  assert.equal(items.length, 1)
  assert.equal(items[0]!.kind, 'tool')
  if (items[0]!.kind === 'tool') {
    assert.equal(items[0]!.intent, null)
    assert.equal(items[0]!.result?.type, 'client_tool_result')
  }
})

test('reasoningByToolCall: splits reasoning by the following tool call; trailing kept apart (ZEA-10087)', () => {
  const contentHot = [
    { type: 'reasoning', text: 'plan call A' },
    { type: 'tool', toolCallId: 'A', toolName: 'bash' },
    { type: 'reasoning', text: 'now B' },
    { type: 'reasoning', text: 'still B' },
    { type: 'tool', toolCallId: 'B', toolName: 'bash' },
    { type: 'reasoning', text: 'wrap up before answering' },
    { type: 'text', text: 'done' },
  ]
  const { byToolCall, trailing } = reasoningByToolCall(contentHot)

  assert.equal(byToolCall.get('A'), 'plan call A')
  assert.equal(byToolCall.get('B'), 'now B\nstill B')
  assert.equal(trailing, 'wrap up before answering')
})

test('reasoningByToolCall: no tools -> everything is trailing; empty for non-arrays', () => {
  assert.deepEqual(reasoningByToolCall([{ type: 'reasoning', text: 'just thinking' }]), {
    byToolCall: new Map(),
    trailing: 'just thinking',
  })
  const empty = reasoningByToolCall(undefined)

  assert.equal(empty.byToolCall.size, 0)
  assert.equal(empty.trailing, '')
})

test('groupJournalEvents: assistant reasoning attaches to tool rows; trailing on the message (ZEA-10087)', () => {
  seq = 0
  const events = [
    event({ type: 'turn_start' }),
    event({
      type: 'tool_call_intent',
      session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: 'A' },
    }),
    event({
      type: 'tool_call_result',
      session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: 'A' },
    }),
    event({
      type: 'assistant_message',
      contentHot: [
        { type: 'reasoning', text: 'why I ran A' },
        { type: 'tool', toolCallId: 'A', toolName: 'bash' },
        { type: 'reasoning', text: 'final thoughts' },
        { type: 'text', text: 'here is the answer' },
      ],
    }),
  ] as AgentJournalEvent[]
  const items = groupJournalEvents(events)
  const toolItem = items.find((i) => i.kind === 'tool')
  const msgItem = items.find((i) => i.kind === 'message')

  assert.equal(toolItem?.kind, 'tool')
  if (toolItem?.kind === 'tool') assert.equal(toolItem.reasoning, 'why I ran A')
  assert.equal(msgItem?.kind, 'message')
  if (msgItem?.kind === 'message') assert.equal(msgItem.trailingReasoning, 'final thoughts')
})

test('groupJournalEvents: all reasoning consumed by tools leaves the assistant with no trailing (ZEA-10087)', () => {
  seq = 0
  const events = [
    event({ type: 'turn_start' }),
    event({
      type: 'tool_call_intent',
      session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: 'A' },
    }),
    event({
      type: 'tool_call_result',
      session: { conversationId: 'conv', requestId: 'req', streamId: 's', toolCallId: 'A' },
    }),
    event({
      type: 'assistant_message',
      // Every reasoning run precedes a tool call; nothing trails before the text.
      contentHot: [
        { type: 'reasoning', text: 'why A' },
        { type: 'tool', toolCallId: 'A', toolName: 'bash' },
        { type: 'text', text: 'answer' },
      ],
    }),
  ] as AgentJournalEvent[]
  const items = groupJournalEvents(events)
  const toolItem = items.find((i) => i.kind === 'tool')
  const msgItem = items.find((i) => i.kind === 'message')

  if (toolItem?.kind === 'tool') assert.equal(toolItem.reasoning, 'why A')
  // No trailing reasoning -> the assistant row shows no reasoning block.
  if (msgItem?.kind === 'message') assert.equal(msgItem.trailingReasoning, undefined)
})
