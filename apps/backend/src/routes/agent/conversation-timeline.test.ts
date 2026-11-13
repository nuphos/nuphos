import { describe, expect, test } from 'bun:test'

import { serializeTimelineEvents, timelineEventUserIds } from './conversation-timeline'

import type { ConversationTimelineEvent } from '@/lib/agent/db/timeline-events'

const at = new Date('2026-10-05T00:00:00Z')
const people = new Map(
  ['alice', 'bob'].map((id) => [
    id,
    { id, name: id[0]!.toUpperCase() + id.slice(1), email: '', avatarURL: '' },
  ]),
)
const events: ConversationTimelineEvent[] = [
  { kind: 'participant_invited', at, actorId: 'alice', targetId: 'bob' },
  { kind: 'participant_removed', at, actorId: 'alice', targetId: 'bob' },
  { kind: 'participant_removed', at, actorId: 'bob', targetId: 'bob' },
  { kind: 'runtime_moved', at, actorId: 'alice', fromLabel: 'Claude Code', toLabel: 'Codex' },
  { kind: 'runtime_moved', at, actorId: 'gone', toLabel: 'Codex' },
]

describe('session timeline events', () => {
  test('render the line both clients show', () => {
    expect(serializeTimelineEvents(events, people).map((event) => event.text)).toEqual([
      'Alice invited Bob into this session',
      'Alice removed Bob from this session',
      'Bob left this session',
      'Alice moved this session from Claude Code to Codex',
      'Someone moved this session to Codex',
    ])
    expect(serializeTimelineEvents(events, people)[0]).toMatchObject({
      kind: 'participant_invited',
      at: '2026-10-05T00:00:00.000Z',
      actor: { id: 'alice', name: 'Alice' },
      target: { id: 'bob', name: 'Bob' },
    })
    expect(serializeTimelineEvents(events, people)[3]).toMatchObject({
      from: { label: 'Claude Code' },
      to: { label: 'Codex' },
    })
  })

  test('an agent that could not reply reads as the chat’s own line', () => {
    const failed: ConversationTimelineEvent[] = [
      { kind: 'agent_reply_failed', at, actorId: 'system', agentName: 'Ops', reason: 'No agent.' },
      { kind: 'agent_reply_failed', at, actorId: 'system', agentName: 'Ops' },
      {
        kind: 'agent_reply_failed',
        at,
        actorId: 'system',
        agentId: 'ops',
        agentName: 'Ops',
        cause: 'usage_limit',
        reason: 'its Claude Code account hit its usage limit.',
        resetsAt: '2026-11-10T16:00:00.000Z',
      },
    ]

    expect(serializeTimelineEvents(failed, people)).toEqual([
      {
        kind: 'agent_reply_failed',
        at: at.toISOString(),
        text: 'Ops couldn’t reply: No agent.',
        cause: 'other',
      },
      {
        kind: 'agent_reply_failed',
        at: at.toISOString(),
        text: 'Ops couldn’t reply.',
        cause: 'other',
      },
      {
        kind: 'agent_reply_failed',
        at: at.toISOString(),
        text: 'Ops couldn’t reply: its Claude Code account hit its usage limit.',
        agentId: 'ops',
        cause: 'usage_limit',
        resetsAt: '2026-11-10T16:00:00.000Z',
      },
    ])
  })

  test('an edit run in a fork links to the fork', () => {
    const edited: ConversationTimelineEvent[] = [
      { kind: 'message_edited', at, actorId: 'alice', forkSessionId: 'fork-1' },
    ]

    expect(serializeTimelineEvents(edited, people)).toEqual([
      {
        kind: 'message_edited',
        at: at.toISOString(),
        text: 'Alice edited a message and ran it in a new task',
        actor: { id: 'alice', name: 'Alice', avatarURL: '' },
        forkSessionId: 'fork-1',
      },
    ])
  })

  test('collect every person an event names, for one member lookup', () => {
    expect(timelineEventUserIds(events)).toEqual([
      'alice',
      'bob',
      'alice',
      'bob',
      'bob',
      'bob',
      'alice',
      'gone',
    ])
    expect(timelineEventUserIds()).toEqual([])
  })
})

test('a normal fork has its own confirmation and destination', () => {
  expect(
    serializeTimelineEvents(
      [{ kind: 'conversation_forked', at, actorId: 'alice', forkSessionId: 'fork-2' }],
      people,
    ),
  ).toEqual([
    {
      kind: 'conversation_forked',
      at: at.toISOString(),
      text: 'Alice forked this conversation',
      actor: { id: 'alice', name: 'Alice', avatarURL: '' },
      forkSessionId: 'fork-2',
    },
  ])
})
