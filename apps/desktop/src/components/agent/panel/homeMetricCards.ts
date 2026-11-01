import { t } from '../../../i18n'

import { catalogEntry } from './homeCardCatalog'
import { AgentTimeBody, PullRequestsBody, SessionsBody, StreakBody } from './homeMetricBodies'
import { LongestRunBody, RuntimeMixBody } from './homeMetricRuns'

import type { MetricCardDef } from './homeMetricShell'
import type { HomeMetricKind } from '../../../types/team.ts'

/** What the gallery lists a metric card by: its title, icon, category and size. */
function card(kind: HomeMetricKind) {
  const { title, icon, category, size } = catalogEntry(kind)

  return { title, icon, category, size }
}

const NO_TURNS = t('No agent turns in this range')

/**
 * How each kind of metric card draws, in the order the gallery lists them;
 * the rest of what describes it is in HOME_CARD_CATALOG. Each draws from the
 * numbers it is given, so the gallery can preview it with sample data.
 */
export const METRIC_CARDS: MetricCardDef[] = [
  {
    kind: 'agent-time',
    ...card('agent-time'),
    noteIcon: true,
    note: t(
      'An estimate. Agent time adds up each turn, from your message to the last reply, so agents running side by side count separately. Human time divides it by an 8 hour workday.',
    ),
    empty: NO_TURNS,
    isEmpty: (s) => s.current.agentMs === 0,
    Body: AgentTimeBody,
  },
  {
    kind: 'sessions',
    ...card('sessions'),
    note: t('Sessions started in the range. Sub-agents are sessions another session started.'),
    empty: t('No sessions started in this range'),
    isEmpty: (s) => s.current.sessions + s.current.subAgents === 0,
    Body: SessionsBody,
  },
  {
    kind: 'pull-requests',
    ...card('pull-requests'),
    noteIcon: true,
    note: t(
      'Pull requests linked to agent sessions, each counted once. Merges from before merge times were recorded are not counted. Overnight means midnight to 7:00 in your time zone, so "while you slept" is a guess.',
    ),
    empty: t('No pull requests linked to agents in this range'),
    isEmpty: (s) => s.current.prsOpened + s.current.prsMerged === 0,
    Body: PullRequestsBody,
  },
  {
    kind: 'streak',
    ...card('streak'),
    fixedRange: true,
    noteIcon: true,
    note: t(
      'Days in a row with at least one agent turn, in your time zone, counted over the last 60 days.',
    ),
    empty: t('No agent turns in the last 60 days'),
    isEmpty: (s) => s.streak.best === 0,
    Body: StreakBody,
  },
  {
    kind: 'longest-run',
    ...card('longest-run'),
    note: t('The longest single turn, from the message to the last reply.'),
    empty: NO_TURNS,
    isEmpty: (s) => !s.longest,
    Body: LongestRunBody,
  },
  {
    kind: 'runtime-mix',
    ...card('runtime-mix'),
    note: t("Each agent's share of agent time."),
    empty: NO_TURNS,
    isEmpty: (s) => s.runtimes.length === 0,
    Body: RuntimeMixBody,
  },
]

export const metricCardDef = (kind: HomeMetricKind) => METRIC_CARDS.find((c) => c.kind === kind)
