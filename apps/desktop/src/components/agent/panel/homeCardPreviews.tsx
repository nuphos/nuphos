import { CircleDot, GitPullRequest, LayoutDashboard } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

import { t } from '../../../i18n'

import { GRID_COLUMNS, catalogEntry } from './homeCardCatalog'
import { HomeCard } from './homeCards'
import {
  SAMPLE_ACTIVITY,
  SAMPLE_PULLS,
  SAMPLE_RUNS,
  SAMPLE_SERIES,
  SAMPLE_STATS,
} from './homeCardSamples'
import { PullRows, RunRows } from './homeGithubRows'
import { metricCardDef } from './homeMetricCards'
import { MetricCardView } from './homeMetricShell'
import { TeamActivityView } from './homeTeamCard'
import {
  PULL_STATUSES,
  RUN_STATUSES,
  filterPulls,
  filterRuns,
  githubCardTitle,
} from './homeWidgetSettings'

import type { HomeCardKind } from './homeCardCatalog'
import type { WithRepo } from './homeGithubRows'
import type { GithubPR, GithubWorkflowRun } from '../../../types'
import type {
  HomeGithubCard,
  HomeMetricKind,
  HomePullStatus,
  HomeRepo,
  HomeRunStatus,
} from '../../../types/team.ts'
import type { ReactNode } from 'react'

// The width of a full and a half row on a typical home page, in pixels.
const FULL_WIDTH = 760
const HALF_WIDTH = 374
const SAMPLE_REPO = 'sample/web-app'
const tagged = <T,>(items: T[]) =>
  items.map((item) => ({ ...item, repo: SAMPLE_REPO, installationId: 0 }))

function PanelSample() {
  const points = SAMPLE_SERIES.map(
    (v, i) => `${String((i / (SAMPLE_SERIES.length - 1)) * 100)},${String(40 - v * 36)}`,
  ).join(' ')

  return (
    <section className="flex h-full min-w-0 flex-col rounded-lg border border-zGray-800/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 px-1 text-[12px] text-secondary">
        <LayoutDashboard className="h-3.5 w-3.5" strokeWidth={1.8} />
        <span>{t('Requests per minute')}</span>
      </div>
      <svg
        viewBox="0 0 100 42"
        preserveAspectRatio="none"
        className="min-h-0 flex-1 text-zViolet-accent"
      >
        <polyline
          points={`0,42 ${points} 100,42`}
          className="fill-current opacity-10"
          stroke="none"
        />
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </section>
  )
}

function MetricSample({ kind }: { kind: HomeMetricKind }) {
  const def = metricCardDef(kind)

  if (!def) return null

  return (
    <MetricCardView
      def={def}
      card={{ id: 'sample', kind, range: '7d', scope: 'me' }}
      stats={SAMPLE_STATS}
      showScope={false}
    />
  )
}

/** Each kind of card drawn by its real component, from sample data. */
const PREVIEWS: Record<HomeCardKind, () => ReactNode> = {
  team: () => <TeamActivityView activity={SAMPLE_ACTIVITY} range="7d" />,
  pulls: () => (
    <HomeCard
      icon={<GitPullRequest className="h-3.5 w-3.5" strokeWidth={1.8} />}
      title={t('Pull requests')}
      menu={null}
      count={SAMPLE_PULLS.length}
      empty=""
      failed={[]}
      total={1}
    >
      <PullRows pulls={tagged(SAMPLE_PULLS)} />
    </HomeCard>
  ),
  ci: () => (
    <HomeCard
      icon={<CircleDot className="h-3.5 w-3.5" strokeWidth={1.8} />}
      title="CI"
      menu={null}
      count={SAMPLE_RUNS.length}
      empty=""
      failed={[]}
      total={1}
    >
      <RunRows runs={tagged(SAMPLE_RUNS)} />
    </HomeCard>
  ),
  'agent-time': () => <MetricSample kind="agent-time" />,
  sessions: () => <MetricSample kind="sessions" />,
  'pull-requests': () => <MetricSample kind="pull-requests" />,
  streak: () => <MetricSample kind="streak" />,
  'longest-run': () => <MetricSample kind="longest-run" />,
  'runtime-mix': () => <MetricSample kind="runtime-mix" />,
  panel: () => <PanelSample />,
}

/**
 * `children`, a card of `kind`, drawn at the card's real size on the home page
 * and scaled down to fit the box it is in. It cannot be focused or clicked,
 * and is hidden from screen readers: whatever shows it describes it.
 */
export function ScaledCard({ kind, children }: { kind: HomeCardKind; children: ReactNode }) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null)
  const size = catalogEntry(kind).size
  const width = size.w === GRID_COLUMNS ? FULL_WIDTH : HALF_WIDTH
  // A card h rows tall is 40h - 12 pixels: 28 per row and 12 between rows.
  const height = 40 * size.h - 12

  useLayoutEffect(() => {
    const el = frameRef.current

    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const { contentRect } of entries) {
        setFrame({ w: contentRect.width, h: contentRect.height })
      }
    })

    observer.observe(el)

    return () => observer.disconnect()
  }, [])
  const scale = frame ? Math.min((frame.w - 24) / width, (frame.h - 20) / height, 1) : 0

  return (
    <div
      ref={frameRef}
      aria-hidden
      inert
      className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
    >
      {frame && (
        <div
          className="flex-none rounded-lg bg-[rgb(var(--color-background-base))] shadow-sm"
          style={{ width, height, transform: `scale(${String(scale)})` }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** A card of `kind` as it looks on the home page, drawn from sample data and marked so. */
export function CardPreview({ kind }: { kind: HomeCardKind }) {
  const Preview = PREVIEWS[kind]

  return (
    <>
      <ScaledCard kind={kind}>
        <Preview />
      </ScaledCard>
      <SampleTag />
    </>
  )
}

/** Marks a preview as drawn from sample data. */
export function SampleTag() {
  return (
    <span
      aria-hidden
      className="absolute right-2 top-2 rounded bg-zGray-800/70 px-1.5 py-px text-[10.5px] text-tertiary"
    >
      {t('Sample')}
    </span>
  )
}

/**
 * A pull request or CI card as setting one up shows it: sample rows spread
 * over the repositories picked and narrowed to the statuses picked, so
 * picking loads nothing.
 */
export function GithubSample({
  kind,
  repos,
  statuses,
}: {
  kind: 'pulls' | 'ci'
  repos: HomeRepo[]
  statuses: string[]
}) {
  const names = repos.map((r) => r.fullName)
  const spread = <T,>(items: T[]) =>
    items.map((item, i) => ({
      ...item,
      repo: names[i % names.length] ?? SAMPLE_REPO,
      installationId: 0,
    }))
  const card = { id: 'sample', kind, repos, statuses } as HomeGithubCard
  const pulls = (
    kind === 'pulls' ? filterPulls(spread(SAMPLE_PULLS), statuses as HomePullStatus[]) : []
  ) as WithRepo<GithubPR>[]
  const runs = (
    kind === 'ci' ? filterRuns(spread(SAMPLE_RUNS), statuses as HomeRunStatus[]) : []
  ) as WithRepo<GithubWorkflowRun>[]
  const empty =
    (kind === 'pulls' ? PULL_STATUSES : RUN_STATUSES).find((s) => statuses.includes(s.value))
      ?.empty ?? ''

  return (
    <HomeCard
      icon={
        kind === 'pulls' ? (
          <GitPullRequest className="h-3.5 w-3.5" strokeWidth={1.8} />
        ) : (
          <CircleDot className="h-3.5 w-3.5" strokeWidth={1.8} />
        )
      }
      title={githubCardTitle(card)}
      menu={null}
      count={kind === 'pulls' ? pulls.length : runs.length}
      empty={empty}
      failed={[]}
      total={repos.length}
    >
      {kind === 'pulls' ? <PullRows pulls={pulls} /> : <RunRows runs={runs} />}
    </HomeCard>
  )
}
