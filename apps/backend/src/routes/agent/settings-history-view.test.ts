import { expect, test } from 'bun:test'

import { serializeSettingsHistory } from './settings-history-view'
import { settingsTimelineLines } from './settings-lines'

import type { SettingsChange } from '@/lib/agent/db/settings-history'

const at = (minute: number) => new Date(Date.UTC(2026, 10, 18, 3, minute))
const lookup = {
  owners: new Map([['yuan', { id: 'yuan', name: 'Yuanlin', email: '', avatarURL: 'a.png' }]]),
  agents: new Map([
    [
      'notes',
      {
        sessionId: 'notes',
        title: 'Release notes for the November desktop and mobile apps',
        provider: 'codex' as const,
      },
    ],
  ]),
}
const sol = { value: 'gpt-6.2-sol', name: 'GPT-6.2-Sol' }
const astra = { value: 'gpt-6.2-astra', name: 'GPT-6.2-Astra' }
const low = { value: 'low', name: 'Low' }
const high = { value: 'high', name: 'High' }
const on = { value: 'on' }
const off = { value: 'off' }
const placed: SettingsChange = {
  at: at(0),
  actorId: 'system',
  via: 'placement',
  runtime: { to: { id: 'cc', label: 'Box', provider: 'claude-code' } },
}
const pick = (minute: number, change: Partial<SettingsChange>): SettingsChange => ({
  at: at(minute),
  actorId: 'yuan',
  via: 'picker',
  client: 'desktop',
  ...change,
})
const texts = (changes: SettingsChange[], times: number[] = []) =>
  settingsTimelineLines(changes, lookup, times.map(at)).map((line) => line.text)

test('a new Task shows nothing for what its agent filled in', () => {
  expect(
    texts([
      placed,
      { at: at(1), actorId: 'system', via: 'session_start', effort: { to: low } },
      {
        at: at(2),
        actorId: 'system',
        via: 'runtime_reported',
        model: { to: sol },
        fast: { to: off },
      },
    ]),
  ).toEqual([])
})

test('a person’s change names the setting as the picker does, and the line carries the rest', () => {
  const lines = settingsTimelineLines(
    [
      placed,
      pick(1, { model: { from: sol, to: astra } }),
      pick(5, { fast: { from: off, to: on } }),
    ],
    lookup,
    [at(3)],
  )

  expect(lines.map((line) => line.text)).toEqual([
    'Yuanlin changed the model from GPT-6.2-Sol to GPT-6.2-Astra',
    'Yuanlin turned fast mode on',
  ])
  expect(lines[0]).toMatchObject({
    kind: 'settings_changed',
    by: { type: 'person', id: 'yuan', name: 'Yuanlin', avatarURL: 'a.png' },
    form: 'changed',
    settings: [{ setting: 'model', from: sol, to: astra }],
    via: 'picker',
    client: 'desktop',
  })
})

test('one save of several settings is one line with the new values', () => {
  expect(
    texts([placed, pick(1, { model: { from: sol, to: astra }, effort: { from: low, to: high } })]),
  ).toEqual(['Yuanlin changed the model to GPT-6.2-Astra and effort to High'])
})

test('consecutive changes by one actor with no message between are one net change', () => {
  const changes = [
    placed,
    pick(1, { model: { from: sol, to: astra } }),
    pick(2, { effort: { from: low, to: high } }),
    pick(3, { model: { from: astra, to: { value: 'gpt-6.2-nova', name: 'GPT-6.2-Nova' } } }),
  ]
  const [line] = settingsTimelineLines(changes, lookup)

  expect(line?.text).toBe('Yuanlin changed the model to GPT-6.2-Nova and effort to High')
  // The tooltip gets the whole change of each setting.
  expect(line).toMatchObject({
    at: at(3).toISOString(),
    settings: [
      { setting: 'model', from: sol, to: { value: 'gpt-6.2-nova', name: 'GPT-6.2-Nova' } },
      { setting: 'effort', from: low, to: high },
    ],
  })
  // A message between them keeps them apart.
  expect(texts(changes, [2])).toEqual([
    'Yuanlin changed the model from GPT-6.2-Sol to GPT-6.2-Astra',
    'Yuanlin changed the model to GPT-6.2-Nova and effort to High',
  ])
})

test('changes that undo each other show nothing', () => {
  expect(
    texts([
      placed,
      pick(1, { model: { from: sol, to: astra } }),
      pick(2, { model: { from: astra, to: sol } }),
    ]),
  ).toEqual([])
})

test('what the new agent picks right after a move goes on the move line', () => {
  const moved: SettingsChange = {
    at: at(10),
    actorId: 'yuan',
    via: 'runtime_move',
    client: 'desktop',
    runtime: {
      from: { id: 'cc', label: 'Box', provider: 'claude-code' },
      to: { id: 'mini', label: 'Mac Mini', provider: 'codex' },
    },
    model: { from: { value: 'opus' } },
  }
  const filled: SettingsChange = {
    at: at(11),
    actorId: 'system',
    via: 'session_start',
    model: { to: sol },
    effort: { to: low },
    fast: { to: off },
  }
  const lines = settingsTimelineLines([placed, moved, filled], lookup)

  expect(lines.map((line) => [line.kind, line.text])).toEqual([
    ['runtime_moved', 'Yuanlin moved this session from Box to Mac Mini · GPT-6.2-Sol · Low'],
  ])
  expect(lines[0]).toMatchObject({
    picks: [
      { setting: 'model', to: sol },
      { setting: 'effort', to: low },
    ],
    via: 'runtime_move',
  })
  // After another change, the agent's picks are a line of their own, fast mode only when on.
  expect(
    texts([
      placed,
      moved,
      pick(11, { effort: { to: high } }),
      { ...filled, at: at(12), fast: { to: on } },
    ]),
  ).toEqual([
    'Yuanlin moved this session from Box to Mac Mini',
    'Yuanlin changed effort to High',
    'Codex set GPT-6.2-Sol · Low · fast mode on',
  ])
})

test('a Task’s change names the Task, cut short, and the person it acted for', () => {
  const [line] = settingsTimelineLines(
    [
      placed,
      {
        at: at(1),
        actorId: 'yuan',
        agentSessionId: 'notes',
        via: 'update_thread',
        model: { from: sol, to: astra },
      },
    ],
    lookup,
  )

  expect(line).toMatchObject({
    text: 'Release notes for the November desktop… (a Task) changed the model from GPT-6.2-Sol to GPT-6.2-Astra',
    by: {
      type: 'task',
      sessionId: 'notes',
      title: 'Release notes for the November desktop and mobile apps',
      provider: 'codex',
    },
    actingFor: 'Yuanlin',
    via: 'update_thread',
  })
})

test('a fallback move keeps its line, and the agent’s own change names the agent', () => {
  const lines = settingsTimelineLines(
    [
      placed,
      {
        at: at(1),
        actorId: 'system',
        via: 'runtime_fallback',
        reason: 'quota',
        runtime: {
          from: { id: 'a', label: 'Box', provider: 'claude-code' },
          to: { id: 'b', label: 'Mini', provider: 'codex' },
        },
        effort: { from: low },
      },
      { at: at(5), actorId: 'system', via: 'runtime_reported', fast: { from: on, to: off } },
    ],
    lookup,
    [at(3)],
  )

  expect(lines.map((line) => line.text)).toEqual([
    'Box was low on usage, so this session moved to Mini',
    'Codex turned fast mode off',
  ])
})

test('the API lists every record oldest first, with moves recorded before the history began', () => {
  const changes = serializeSettingsHistory(
    {
      settingsHistory: [
        pick(23, { model: { to: sol } }),
        { at: at(30), actorId: 'system', via: 'session_start', effort: { to: low } },
      ],
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
      text: 'Yuanlin changed the model to GPT-6.2-Sol',
    },
    {
      at: at(30).toISOString(),
      actor: { type: 'system' },
      via: 'session_start',
      effort: { to: low },
      text: 'The agent set Low',
    },
  ])
})

test('values read as the picker shows them, and its "Default" is no model to come from', () => {
  expect(
    texts(
      [
        placed,
        pick(1, {
          model: { from: { value: 'default', name: 'Default (recommended)' }, to: astra },
        }),
        pick(3, {
          effort: { from: { value: 'low', name: 'low' }, to: { value: 'high', name: 'high' } },
        }),
      ],
      [2],
    ),
  ).toEqual([
    'Yuanlin changed the model to GPT-6.2-Astra',
    'Yuanlin changed effort from Low to High',
  ])
})

test('settings stored at the agent’s default alongside a pick change nothing', () => {
  expect(
    texts([
      placed,
      {
        at: at(1),
        actorId: 'yuan',
        agentSessionId: 'notes',
        via: 'create_thread',
        model: { to: astra },
        effort: { to: { value: 'default' } },
        fast: { to: off },
      },
      {
        at: at(2),
        actorId: 'system',
        via: 'runtime_reported',
        effort: { to: { value: 'default', name: 'Default' } },
      },
    ]),
  ).toEqual(['Release notes for the November desktop… (a Task) changed the model to GPT-6.2-Astra'])
})

test('a new Task’s first picks show nothing, and a later change from them does', () => {
  expect(
    texts([
      placed,
      pick(1, { via: 'new_chat', model: { to: sol }, fast: { to: on } }),
      pick(3, { model: { from: sol, to: astra } }),
    ]),
  ).toEqual(['Yuanlin changed the model from GPT-6.2-Sol to GPT-6.2-Astra'])
})
