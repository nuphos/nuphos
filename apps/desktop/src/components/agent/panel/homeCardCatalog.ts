import {
  CircleDot,
  Cpu,
  Flame,
  GitMerge,
  GitPullRequest,
  Hourglass,
  LayoutDashboard,
  Network,
  Timer,
  Users,
} from 'lucide-react'

import { t } from '../../../i18n/index.ts'

import { metricSize, metricTitle } from './homeMetricFormat.ts'

import type { HomeLayout, HomeMetricKind } from '../../../types/team.ts'
import type { LucideIcon } from 'lucide-react'

export const GRID_COLUMNS = 12

/** The group a card is filed under in the card gallery. */
export type HomeCardCategory = 'activity' | 'metrics' | 'github' | 'dashboards'

/** Every kind of home card. */
export type HomeCardKind = 'team' | 'pulls' | 'ci' | HomeMetricKind | 'panel'

/**
 * How a kind is added: `once` is on or off, `many` adds another card each
 * time, `configure` asks for its settings first and can be added any number
 * of times, and `pick` chooses which dashboard panels to pin.
 */
export type HomeCardAdd = 'once' | 'many' | 'configure' | 'pick'

/** A kind of home card as the gallery lists it, and the size it starts at on the grid. */
export type HomeCardEntry = {
  kind: HomeCardKind
  category: HomeCardCategory
  title: string
  icon: LucideIcon
  /** One line on what the card shows. */
  description: string
  /** Other words a search should find it by. */
  keywords: string[]
  /** Its size when added, in columns of 12 and rows. */
  size: { w: number; h: number }
  add: HomeCardAdd
}

export const HOME_CARD_CATEGORIES: { value: HomeCardCategory; label: string }[] = [
  { value: 'activity', label: t('Activity') },
  { value: 'metrics', label: t('Metrics') },
  { value: 'github', label: 'GitHub' },
  { value: 'dashboards', label: t('Dashboards') },
]

const HALF = GRID_COLUMNS / 2

const metric = (
  kind: HomeMetricKind,
  icon: LucideIcon,
  description: string,
  keywords: string[],
): HomeCardEntry => ({
  kind,
  category: 'metrics',
  title: metricTitle(kind),
  icon,
  description,
  keywords,
  size: metricSize(kind),
  add: 'many',
})

/** Every kind of home card, in the order the gallery lists them. */
export const HOME_CARD_CATALOG: HomeCardEntry[] = [
  {
    kind: 'team',
    category: 'activity',
    title: t('Team activity'),
    icon: Users,
    description: t('Who on the team ran agents, and when, as a heatmap.'),
    keywords: ['heatmap', 'members', 'people'],
    size: { w: GRID_COLUMNS, h: 8 },
    add: 'once',
  },
  {
    kind: 'pulls',
    category: 'github',
    title: t('Pull requests'),
    icon: GitPullRequest,
    description: t('Open pull requests in the repositories you pick.'),
    keywords: ['github', 'pr', 'review', 'draft'],
    size: { w: HALF, h: 7 },
    add: 'configure',
  },
  {
    kind: 'ci',
    category: 'github',
    title: 'CI',
    icon: CircleDot,
    description: t('Failing, running or latest CI runs in the repositories you pick.'),
    keywords: ['github', 'actions', 'workflows', 'builds', 'checks'],
    size: { w: HALF, h: 7 },
    add: 'configure',
  },
  metric(
    'agent-time',
    Timer,
    t('How long agents worked, and the human workdays that adds up to.'),
    ['hours', 'duration', 'estimate'],
  ),
  metric('sessions', Network, t('Sessions started, and the sub-agents they spawned.'), [
    'conversations',
    'subagents',
    'trend',
  ]),
  metric(
    'pull-requests',
    GitMerge,
    t('Pull requests agents opened and merged, some while you slept.'),
    ['github', 'pr', 'merged', 'overnight'],
  ),
  metric('streak', Flame, t('Days in a row with at least one agent turn.'), ['days', 'habit']),
  metric('longest-run', Hourglass, t('The longest single agent turn in the range.'), [
    'duration',
    'record',
  ]),
  metric('runtime-mix', Cpu, t('Which agents did the work, by share of agent time.'), [
    'runtimes',
    'claude',
    'codex',
    'share',
  ]),
  {
    kind: 'panel',
    category: 'dashboards',
    title: t('Dashboard panel'),
    icon: LayoutDashboard,
    description: t('Pin any panel from your Nuphos dashboards.'),
    keywords: ['chart', 'graph', 'dashboards', 'pin'],
    size: { w: HALF, h: 6 },
    add: 'pick',
  },
]

const BY_KIND = new Map<string, HomeCardEntry>(HOME_CARD_CATALOG.map((c) => [c.kind, c]))

/**
 * The entry for `kind`, or undefined for a kind this desktop does not know, as
 * in a layout saved by a newer desktop: such a card is left out rather than
 * shown as another kind.
 */
export const homeCardEntry = (kind: string): HomeCardEntry | undefined => BY_KIND.get(kind)

/** Whether a saved card is of a kind this desktop knows how to show. */
export const isKnownCard = (card: { kind: string }): boolean => BY_KIND.has(card.kind)

/** The entry for a kind named in the code, which the catalog always has. */
export function catalogEntry(kind: HomeCardKind): HomeCardEntry {
  const entry = BY_KIND.get(kind)

  if (!entry) throw new Error(`The home card catalog has no ${kind} card`)

  return entry
}

/**
 * The kind of the card with grid key `key`, or null for one this desktop does
 * not know. A GitHub card's key holds only its id, so its kind comes from
 * `layout`; without one it reads as a pull request card, which has the same
 * size.
 */
export function cardKind(key: string, layout?: HomeLayout): HomeCardKind | null {
  if (key === 'team') return 'team'
  if (key.startsWith('panel:')) return 'panel'
  if (key.startsWith('metric:')) {
    const kind = key.split(':')[1] ?? ''

    return homeCardEntry(kind) ? (kind as HomeMetricKind) : null
  }
  if (key.startsWith('gh:')) {
    const kind = layout?.github.find((c) => `gh:${c.id}` === key)?.kind ?? 'pulls'

    return homeCardEntry(kind) ? kind : null
  }

  return null
}

/** How many cards of `kind` the home page shows. */
export function cardsOnHome(layout: HomeLayout, kind: HomeCardKind): number {
  if (kind === 'team') return layout.team ? 1 : 0
  if (kind === 'panel') return layout.panels.length
  if (kind === 'pulls' || kind === 'ci') return layout.github.filter((c) => c.kind === kind).length

  return (layout.metrics ?? []).filter((c) => c.kind === kind).length
}

const fold = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')

/**
 * The kinds in `category` (all with `'all'`) that match `query`: every word
 * of it is found in a title, description, category name or keyword.
 */
export function findCards(query: string, category: HomeCardCategory | 'all'): HomeCardEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean)

  return HOME_CARD_CATALOG.filter((card) => {
    if (category !== 'all' && card.category !== category) return false
    const categoryLabel = HOME_CARD_CATEGORIES.find((c) => c.value === card.category)?.label ?? ''
    const text = fold([card.title, card.description, categoryLabel, ...card.keywords].join(' '))

    return words.every((word) => text.includes(word))
  })
}
