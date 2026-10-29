import { Flame, GitMerge, Network, Timer } from 'lucide-react'

import { t } from '../../../i18n'

import { AgentTimeBody, PullRequestsBody, SessionsBody, StreakBody } from './homeMetricBodies'
import { metricSize, metricTitle } from './homeMetricFormat'

import type { MetricCardDef } from './homeMetricShell'
import type { HomeMetricKind } from '../../../types/team.ts'

/**
 * Every kind of metric card, in the order a picker lists them. Each draws
 * from the numbers it is given, so a picker can preview it with sample data.
 */
export const METRIC_CARDS: MetricCardDef[] = [
  {
    kind: 'agent-time',
    title: metricTitle('agent-time'),
    category: 'metrics',
    icon: Timer,
    size: metricSize('agent-time'),
    noteIcon: true,
    note: t(
      'An estimate. Agent time adds up each turn, from your message to the last reply, so agents running side by side count separately. Human time divides it by an 8 hour workday.',
    ),
    empty: t('No agent turns in this range'),
    isEmpty: (s) => s.current.agentMs === 0,
    Body: AgentTimeBody,
  },
  {
    kind: 'sessions',
    title: metricTitle('sessions'),
    category: 'metrics',
    icon: Network,
    size: metricSize('sessions'),
    note: t('Sessions started in the range. Sub-agents are sessions another session started.'),
    empty: t('No sessions started in this range'),
    isEmpty: (s) => s.current.sessions + s.current.subAgents === 0,
    Body: SessionsBody,
  },
  {
    kind: 'pull-requests',
    title: metricTitle('pull-requests'),
    category: 'metrics',
    icon: GitMerge,
    size: metricSize('pull-requests'),
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
    title: metricTitle('streak'),
    category: 'metrics',
    icon: Flame,
    size: metricSize('streak'),
    fixedRange: true,
    noteIcon: true,
    note: t(
      'Days in a row with at least one agent turn, in your time zone, counted over the last 60 days.',
    ),
    empty: t('No agent turns in the last 60 days'),
    isEmpty: (s) => s.streak.best === 0,
    Body: StreakBody,
  },
]

export const metricCardDef = (kind: HomeMetricKind) => METRIC_CARDS.find((c) => c.kind === kind)
