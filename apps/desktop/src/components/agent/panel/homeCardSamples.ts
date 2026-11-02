import { t } from '../../../i18n/index.ts'

import type { GithubPR, GithubWorkflowRun } from '../../../types'
import type { AgentStats, TeamActivity } from '../../../types/team.ts'

// Sample numbers the card gallery previews each kind of card with. None of
// them come from the team: a preview shows what a card looks like, not what it
// would say.

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
// A fixed moment, so every preview draws the same.
const NOW = Date.UTC(2026, 0, 15, 18)
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

export const SAMPLE_STATS: AgentStats = {
  range: '7d',
  scope: 'me',
  timeZone: 'UTC',
  current: {
    agentMs: 19 * HOUR_MS,
    turns: 64,
    sessions: 12,
    subAgents: 31,
    prsOpened: 9,
    prsMerged: 7,
    prsMergedOvernight: 3,
  },
  previous: {
    agentMs: 15 * HOUR_MS,
    turns: 50,
    sessions: 14,
    subAgents: 20,
    prsOpened: 6,
    prsMerged: 5,
    prsMergedOvernight: 1,
  },
  streak: { current: 5, best: 9, lookbackDays: 60 },
  longest: {
    ms: 3 * HOUR_MS + 12 * 60_000,
    startedAt: iso(DAY_MS),
    session: { id: 'sample-1', title: t('Migrate the billing jobs') },
  },
  fanOut: { count: 6, session: { id: 'sample-2', title: t('Release checklist') } },
  peak: { count: 4, at: iso(2 * DAY_MS) },
  runtimes: [
    { runtime: 'claude-code', agentMs: 11 * HOUR_MS },
    { runtime: 'codex', agentMs: 6 * HOUR_MS },
    { runtime: 'opencode', agentMs: 2 * HOUR_MS },
  ],
  capped: false,
}

/** A week of two-hour slots for three people, busy in the working hours. */
export const SAMPLE_ACTIVITY: TeamActivity = {
  range: '7d',
  slotMinutes: 120,
  start: iso(7 * DAY_MS),
  sessions: [0, 1, 2, 3].map((i) => ({
    id: `sample-${String(i)}`,
    title: t('Sample session'),
    runtime: null,
  })),
  members: ['Avery', 'Blake', 'Casey'].map((name, m) => ({
    id: `sample-${name}`,
    name,
    avatarURL: '',
    slots: Array.from({ length: 84 }, (_, i) => {
      const hour = (i % 12) * 2
      const busy = hour >= 8 && hour <= 18 && (i + m * 5) % 7 !== 0

      return busy ? [0, 1, 2, 3].slice(0, 1 + ((i * 3 + m) % 4)) : []
    }),
  })),
}

const pull = (number: number, title: string, draft: boolean, hoursAgo: number): GithubPR => ({
  number,
  title,
  state: 'open',
  draft,
  author: 'avery',
  authorAvatarUrl: '',
  labels: [],
  createdAt: iso(hoursAgo * HOUR_MS + DAY_MS),
  updatedAt: iso(hoursAgo * HOUR_MS),
  htmlUrl: '',
  headRef: `sample-${String(number)}`,
  baseRef: 'main',
})

export const SAMPLE_PULLS: GithubPR[] = [
  pull(42, t('Add a retry budget to the sync worker'), false, 2),
  pull(41, t('Fix the flaky checkout test'), false, 5),
  pull(40, t('New onboarding checklist'), true, 9),
]

const run = (id: number, name: string, conclusion: string | null): GithubWorkflowRun => ({
  id,
  name,
  status: conclusion ? 'completed' : 'in_progress',
  conclusion,
  event: 'push',
  headBranch: 'main',
  headSha: String(id),
  createdAt: iso(id * HOUR_MS),
  updatedAt: iso(id * HOUR_MS),
  htmlUrl: '',
})

export const SAMPLE_RUNS: GithubWorkflowRun[] = [
  run(1, 'CI', 'failure'),
  run(2, 'E2E', null),
  run(3, 'Lint', 'success'),
]

/** A sample panel's line, as points from 0 (bottom) to 1 (top). */
export const SAMPLE_SERIES = [
  0.32, 0.4, 0.36, 0.48, 0.44, 0.58, 0.52, 0.66, 0.6, 0.72, 0.64, 0.78, 0.7, 0.84,
]
