import { expect, test } from 'bun:test'

import { serializeSettingsHistory, settingsTimelineLines } from './settings-history-view'

import type { SettingsChange } from '@/lib/agent/db/settings-history'

const at = (minute: number) => new Date(Date.UTC(2026, 10, 18, 3, minute))
const lookup = {
  owners: new Map([['yuan', { id: 'yuan', name: 'Yuanlin', email: '', avatarURL: 'a.png' }]]),
  agents: new Map([['eh', { sessionId: 'eh', title: 'Engineering Head' }]]),
}
const sol = { value: 'gpt-6.2-sol', name: 'GPT-6.2-Sol' }
const astra = { value: 'gpt-6.2-astra', name: 'GPT-6.2-Astra' }
const low = { value: 'low', name: 'Low' }
const medium = { value: 'medium', name: 'Medium' }
const history: SettingsChange[] = [
  { at: at(0), actorId: 'system', via: 'placement', runtime: { to: { id: 'cc', label: 'Box' } } },
  {
    at: at(22),
    actorId: 'yuan',
    via: 'runtime_move',
    client: 'desktop',
    runtime: {
      from: { id: 'cc', label: 'Box', provider: 'claude-code' },
      to: { id: 'mini', label: 'Mac Mini', provider: 'codex' },
    },
    model: { from: { value: 'opus' } },
  },
  { at: at(23), actorId: 'yuan', via: 'picker', client: 'desktop', model: { to: sol } },
  { at: at(30), actorId: 'system', via: 'session_start', effort: { to: low } },
  {
    at: at(40),
    actorId: 'yuan',
    agentSessionId: 'eh',
    via: 'update_thread',
    model: { from: sol, to: astra },
    effort: { from: low, to: medium },
  },
  {
    at: at(50),
    actorId: 'system',
    via: 'runtime_reported',
    fast: { from: { value: 'on' }, to: { value: 'off' } },
  },
]

test('each change is a line between the messages, naming who, what and from where', () => {
  const lines = settingsTimelineLines(history, lookup)

  expect(lines.map((line) => [line.kind, line.text])).toEqual([
    ['runtime_moved', 'Yuanlin moved this session from Box to Mac Mini'],
    [
      'settings_changed',
      'Yuanlin changed the model back to the agent’s default (was opus) · Desktop',
    ],
    ['settings_changed', 'Yuanlin changed the model to GPT-6.2-Sol · Desktop'],
    ['settings_changed', 'The session started with effort Low'],
    [
      'settings_changed',
      'Engineering Head (for Yuanlin) changed the model from GPT-6.2-Sol to GPT-6.2-Astra, effort from Low to Medium · update_thread',
    ],
    ['settings_changed', 'The agent changed its fast mode from on to off'],
  ])
  // A session that names its settings only after its first turn reads as having started on them.
  const [first] = settingsTimelineLines(
    [{ at: at(5), actorId: 'system', via: 'runtime_reported', model: { to: sol } }],
    lookup,
  )

  expect(first?.text).toBe('The session started with model GPT-6.2-Sol')
  // What a client needs to draw the line its own way.
  expect(lines[2]).toMatchObject({
    via: 'picker',
    client: 'desktop',
    actor: { id: 'yuan', name: 'Yuanlin', avatarURL: 'a.png' },
    model: { to: sol },
  })
  expect(lines[3]).not.toHaveProperty('actor')
  expect(lines[4]).toMatchObject({ agentSessionId: 'eh', via: 'update_thread' })
})

test('a fallback move says why, and a change no one asked for says when', () => {
  const lines = settingsTimelineLines(
    [
      {
        at: at(0),
        actorId: 'system',
        via: 'runtime_fallback',
        reason: 'quota',
        runtime: { from: { id: 'a', label: 'Box' }, to: { id: 'b', label: 'Mini' } },
        effort: { from: low },
      },
    ],
    lookup,
  )

  expect(lines.map((line) => line.text)).toEqual([
    'Box was low on usage, so this session moved to Mini',
    'Effort back to the agent’s default (was Low) after a fallback move',
  ])
})

test('the API lists every record oldest first, with moves recorded before the history began', () => {
  const changes = serializeSettingsHistory(
    {
      settingsHistory: history.slice(2, 4),
      timelineEvents: [
        {
          kind: 'runtime_moved',
          at: at(10),
          actorId: 'yuan',
          fromLabel: 'Old',
          fromProvider: 'claude-code',
          toLabel: 'Box',
          toProvider: 'claude-code',
        },
        { kind: 'participant_invited', at: at(11), actorId: 'yuan', targetId: 'x' },
      ],
    },
    lookup,
  )

  expect(changes).toEqual([
    {
      at: at(10).toISOString(),
      actor: { type: 'user', userId: 'yuan', name: 'Yuanlin' },
      via: 'runtime_move',
      runtime: {
        from: { label: 'Old', provider: 'claude-code' },
        to: { label: 'Box', provider: 'claude-code' },
      },
    },
    {
      at: at(23).toISOString(),
      actor: { type: 'user', userId: 'yuan', name: 'Yuanlin' },
      via: 'picker',
      client: 'desktop',
      model: { to: sol },
      text: 'Yuanlin changed the model to GPT-6.2-Sol · Desktop',
    },
    {
      at: at(30).toISOString(),
      actor: { type: 'system' },
      via: 'session_start',
      effort: { to: low },
      text: 'The session started with effort Low',
    },
  ])
})

test('an agent’s change names the agent and the person it acted for', () => {
  const [change] = serializeSettingsHistory({ settingsHistory: [history[4]!] }, lookup)

  expect(change?.actor).toEqual({
    type: 'agent',
    userId: 'yuan',
    name: 'Yuanlin',
    agentSessionId: 'eh',
    agentTitle: 'Engineering Head',
  })
})
