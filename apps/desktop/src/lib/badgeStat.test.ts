import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { BADGE_STATS, DEFAULT_BADGE_STAT, readBadge } from './badgeStat.ts'

import type { BadgeInputs } from './badgeStat.ts'
import type { RuntimeExecution } from './runtimeExecution.ts'
import type { AgentConversation } from '../api/agent-types.ts'
import type { RuntimeQuota } from '../types/runtime.ts'

function session(id: string, extra: Partial<AgentConversation> = {}): AgentConversation {
  return {
    sessionId: id,
    title: id,
    firstMessage: '',
    messageCount: 1,
    createdAt: '2026-10-20T00:00:00Z',
    lastActiveAt: '2026-10-20T00:00:00Z',
    isOwner: true,
    ...extra,
  }
}

const active: RuntimeExecution = { state: 'active', phase: 'turn' }
const idle: RuntimeExecution = { state: 'idle' }

function inputs(extra: Partial<BadgeInputs> = {}): BadgeInputs {
  return { sessions: [], runtimeStates: new Map(), quotas: new Map(), mergedPrs: null, ...extra }
}

test('the picker lists the stats in order, PRs merged first and by default', () => {
  assert.deepEqual(BADGE_STATS, ['merged-prs', 'running', 'waiting', 'quota', 'none'])
  assert.equal(DEFAULT_BADGE_STAT, 'merged-prs')
})

test('PRs merged this month: a plain count on a quiet ring, scoped to linked PRs', () => {
  assert.deepEqual(readBadge('merged-prs', inputs({ mergedPrs: 4 })), {
    badge: '4',
    fraction: null,
    summary: '4 PRs merged this month, linked to your sessions',
  })
  assert.equal(readBadge('merged-prs', inputs({ mergedPrs: 1 })).summary.startsWith('1 PR '), true)
  assert.equal(readBadge('merged-prs', inputs({ mergedPrs: 0 })).badge, '0')
  // Unknown, or a server that cannot count them: no badge rather than a wrong zero.
  assert.equal(readBadge('merged-prs', inputs()).badge, undefined)
})

test('running: own live sessions with a turn running', () => {
  const sessions = [
    session('old', { lastActiveAt: '2026-10-20T00:00:00Z' }),
    session('new', { lastActiveAt: '2026-10-23T00:00:00Z' }),
    session('idle'),
    session('shared', { isOwner: false }),
    session('archived', { archivedAt: '2026-10-21T00:00:00Z' }),
    session('listed', { activeRun: { streamId: 's', startedAt: null } }),
  ]
  const runtimeStates = new Map<string, RuntimeExecution>([
    ['old', active],
    ['new', active],
    ['idle', idle],
    ['shared', active],
    ['archived', active],
  ])
  const reading = readBadge('running', inputs({ sessions, runtimeStates }))

  assert.equal(reading.badge, '3')
  assert.equal(reading.fraction, null)
  assert.equal(reading.summary, '3 sessions running now')
  assert.equal(readBadge('running', inputs()).badge, '0')
})

test('waiting: questions and approvals, as a share of active sessions, hidden at zero', () => {
  const sessions = [
    session('asked', {
      pendingDecision: {
        category: 'x',
        question: 'Ship?',
        toolCallId: 't',
        askedAt: '2026-10-23T00:00:00Z',
      },
    }),
    session('approval', {
      runtimeState: { state: 'active', requests: [{ waitId: 'w', kind: 'tool', createdAt: 1 }] },
    }),
    session('working'),
    session('quiet'),
  ]
  const runtimeStates = new Map([['working', active]])
  const reading = readBadge('waiting', inputs({ sessions, runtimeStates }))

  assert.equal(reading.badge, '2')
  assert.equal(reading.fraction, 2 / 3)
  assert.equal(reading.summary, '2 sessions waiting on you')
  const none = readBadge('waiting', inputs({ sessions: [session('quiet')] }))

  assert.equal(none.badge, undefined)
  assert.equal(none.fraction, 0)
  assert.equal(none.summary, 'Nothing is waiting on you')
})

test('quota: the 5-hour window of the runtime behind the latest session fills the ring', () => {
  const quota = (runtimeId: string, windows: RuntimeQuota['windows']): RuntimeQuota => ({
    runtimeId,
    provider: 'claude-code',
    fetchedAt: '2026-10-23T00:00:00Z',
    available: true,
    windows,
  })
  const quotas = new Map([
    [
      'claude',
      quota('claude', [
        { id: 'five_hour', label: '5-hour', usedPercent: 38.26, resetsAt: null },
        { id: 'seven_day', label: 'Weekly', usedPercent: 90, resetsAt: null },
      ]),
    ],
    [
      'codex',
      quota('codex', [{ id: 'primary', label: '5-hour', usedPercent: 61, resetsAt: null }]),
    ],
  ])
  const sessions = [
    session('a', {
      runtimeId: 'codex',
      runtimeLabel: 'Codex',
      lastActiveAt: '2026-10-20T00:00:00Z',
    }),
    session('b', {
      runtimeId: 'claude',
      runtimeLabel: 'Claude',
      lastActiveAt: '2026-10-23T00:00:00Z',
    }),
  ]

  assert.deepEqual(readBadge('quota', inputs({ sessions, quotas })), {
    badge: '38%',
    fraction: 0.38,
    summary: '38% of the 5-hour limit used on Claude',
  })
  assert.equal(readBadge('quota', inputs({ sessions: [sessions[0]], quotas })).badge, '61%')
  assert.equal(readBadge('quota', inputs({ sessions })).badge, undefined, 'no quota read yet')
})

test('none: just the character', () => {
  assert.deepEqual(readBadge('none', inputs({ mergedPrs: 9 })), {
    fraction: null,
    summary: 'Just your character',
  })
})

test('no XP or level code is left in the character and its badge', () => {
  const files = [
    '../components/sidebar/WorkspaceBadge.tsx',
    '../views/settings/SidebarBadgeSection.tsx',
    '../views/settings/ProfileCharacterSection.tsx',
    '../components/sidebar/CharacterRing.tsx',
    '../components/sidebar/CharacterRing.css',
    '../hooks/useProfileCharacter.ts',
    '../hooks/useBadgeStat.ts',
    './profileCharacter.ts',
    './badgeStat.ts',
    '../types/team.ts',
    '../api/window-app.ts',
    '../../electron/auth/profile.ts',
    '../../electron/preload-parts/api-profile.ts',
    '../../electron/main/channels-app.ts',
  ]

  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')

    assert.doesNotMatch(
      source,
      /\b(xp|level|levels|levelled|activeDays)\b|ReadLevel|readLevel|me\/level/i,
      file,
    )
  }
})
