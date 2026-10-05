import { describe, expect, test } from 'bun:test'

import { serializeTimelineEvents, timelineEventUserIds } from './conversation-timeline'

import type { ConversationTimelineEvent } from '@/lib/agent/db/shared'

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
    })
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
