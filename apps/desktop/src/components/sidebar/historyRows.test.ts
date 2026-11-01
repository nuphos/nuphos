import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fullHistoryRows, historyAge, historyMenuRows } from './historyRows.ts'

import type { AgentConversation } from '../../api/agent-types'
import type { SurfaceEntry } from '../../app/workspace/store/workspaceState'
import type { NavigationSnapshot } from '../../lib/appRoutes'

const chat = (sessionId: string | null, at = 0): SurfaceEntry => ({
  sessionId,
  sessionReadOnly: false,
  teamScope: null,
  mainPageOpen: false,
  at,
})
const page = (active: string): SurfaceEntry => ({
  ...chat(null),
  mainPageOpen: true,
  page: { active } as NavigationSnapshot,
})
const titles: Record<string, string> = { a: 'Fix login', b: 'Deploy API' }
const title = (id: string) =>
  titles[id] ? ({ sessionId: id, title: titles[id] } as AgentConversation) : undefined

test('Back lists at most five places, nearest first, with chat titles and page names', () => {
  const entries = [
    chat('a'),
    page('team.inbox'),
    chat('b'),
    chat('x'),
    chat('a'),
    chat('b'),
    page('team.agents'),
  ]
  const rows = historyMenuRows({ entries, index: 6 }, -1, title)

  assert.deepEqual(
    rows.map((row) => row.label),
    ['Deploy API', 'Fix login', 'Untitled chat', 'Deploy API', 'Inbox'],
  )
  assert.deepEqual(historyMenuRows({ entries, index: 6 }, 1, title), [])
})

test('Forward lists what lies ahead after going Back', () => {
  const entries = [chat('a'), page('team.agents'), chat(null)]

  assert.deepEqual(
    historyMenuRows({ entries, index: 0 }, 1, title).map((row) => [row.index, row.label]),
    [
      [1, 'Runtimes'],
      [2, 'New chat'],
    ],
  )
})

test('full history runs newest first and marks where the user is', () => {
  const rows = fullHistoryRows({ entries: [chat('a'), chat('b')], index: 0 }, title)

  assert.deepEqual(
    rows.map((row) => [row.label, row.current]),
    [
      ['Deploy API', false],
      ['Fix login', true],
    ],
  )
})

test('ages read like a browser history', () => {
  const now = 10 * 86_400_000

  assert.equal(historyAge(now - 10_000, now), 'Just now')
  assert.equal(historyAge(now - 5 * 60_000, now), '5m ago')
  assert.equal(historyAge(now - 3 * 3_600_000, now), '3h ago')
  assert.equal(historyAge(now - 2 * 86_400_000, now), '2d ago')
})
