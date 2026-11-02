import { Button as BaseButton } from '@base-ui/react/button'
import clsx from 'clsx'
import { Info } from 'lucide-react'
import { useId } from 'react'

import { t } from '../../../i18n'
import { Tooltip } from '../../ui/tooltip'

import { SCOPES, changePercent } from './homeMetricFormat'
import { MetricCardMenu } from './homeMetricMenu'
import { ACTIVITY_RANGES } from './teamActivity'

import type { HomeCardCategory } from './homeCardCatalog'
import type {
  AgentStats,
  TeamActivityRange,
  AgentStatsSession,
  HomeMetricCard,
  HomeMetricKind,
} from '../../../types/team.ts'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

const CAPPED = t('Only the most recently active sessions were counted, so the numbers may be low.')

export type MetricBodyProps = {
  stats: AgentStats
  /** Opens a conversation the card names; absent in a preview. */
  onOpenConversation?: (sessionId: string, title: string) => void
}

/**
 * A kind of metric card: what a card picker lists and how the card draws.
 * `Body` draws from `stats` alone, so a preview can pass sample numbers.
 */
export type MetricCardDef = {
  kind: HomeMetricKind
  title: string
  /** The group the card gallery files it under. */
  category: HomeCardCategory
  icon: LucideIcon
  /** Its size on the home grid, in columns of 12 and rows. */
  size: { w: number; h: number }
  /** Counted over the last 60 days whatever the range, so the card has no range to pick. */
  fixedRange?: boolean
  /** How the number is counted; shown when the title is hovered. */
  note?: string
  /** Shows the note behind an info icon too: for estimates and rules that are not obvious. */
  noteIcon?: boolean
  /** Shown when the range has nothing to count. */
  empty: string
  isEmpty: (stats: AgentStats) => boolean
  Body: (props: MetricBodyProps) => ReactNode
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-7 w-20 rounded-md bg-zGray-800/40 animate-pulse" />
      <div className="h-3 w-32 rounded bg-zGray-800/40 animate-pulse" />
    </div>
  )
}

/** Icon, title, range and scope, and the card's menu, at the same height on every card. */
function MetricCardHeader({
  def,
  card,
  note,
  showScope,
  onChange,
  onRemove,
}: {
  def: MetricCardDef
  card: HomeMetricCard
  /** How the number is counted, reached by hover or keyboard. */
  note?: string
  showScope: boolean
  onChange?: (card: HomeMetricCard) => void
  onRemove?: () => void
}) {
  const Icon = def.icon
  const noteId = useId()
  const scope = SCOPES.find((s) => s.value === card.scope)
  const range = ACTIVITY_RANGES.find((r) => r.value === card.range)
  const label = [def.fixedRange ? null : range?.label, showScope ? scope?.label : null]
    .filter(Boolean)
    .join(' · ')
  let title: ReactNode = <span className="truncate">{def.title}</span>

  // The title itself explains the card, as a button so the keyboard reaches it too.
  if (note && !def.noteIcon) {
    title = (
      <Tooltip content={note} triggerClassName="min-w-0">
        <BaseButton
          aria-describedby={noteId}
          className="truncate text-left outline-none focus-visible:underline"
        >
          {def.title}
        </BaseButton>
      </Tooltip>
    )
  }

  return (
    <div className="home-card-drag cursor-grab active:cursor-grabbing mb-2 flex h-5 flex-none items-center gap-1.5 px-1 text-[12px] text-secondary">
      <Icon className="h-3.5 w-3.5 flex-none" strokeWidth={1.8} />
      {title}
      {note && def.noteIcon && (
        <Tooltip content={note}>
          <BaseButton
            aria-label={t('How this is counted')}
            aria-describedby={noteId}
            className="flex flex-none rounded text-tertiary outline-none transition-colors hover:text-main focus-visible:text-main focus-visible:ring-1 focus-visible:ring-zGray-600"
          >
            <Info className="h-3 w-3" strokeWidth={1.8} />
          </BaseButton>
        </Tooltip>
      )}
      {note && (
        <span id={noteId} className="sr-only">
          {note}
        </span>
      )}
      {label && <span className="flex-none text-tertiary">· {label}</span>}
      <span className="ml-auto" />
      {onChange && onRemove && (
        <MetricCardMenu
          card={card}
          showRange={!def.fixedRange}
          showScope={showScope}
          onChange={onChange}
          onRemove={onRemove}
        />
      )}
    </div>
  )
}

/**
 * A metric card as it shows on the home page, from numbers already loaded:
 * a skeleton while `stats` is null, the kind's empty text when the range has
 * nothing to count, and its body otherwise. Without `onChange` it is a
 * preview: no menu, nothing to open.
 */
export function MetricCardView({
  def,
  card,
  stats,
  failed = false,
  showScope,
  onChange,
  onRemove,
  onOpenConversation,
}: {
  def: MetricCardDef
  card: HomeMetricCard
  stats: AgentStats | null
  failed?: boolean
  /** Whether the team has anyone else to count. */
  showScope: boolean
  onChange?: (card: HomeMetricCard) => void
  onRemove?: () => void
  onOpenConversation?: (sessionId: string, title: string) => void
}) {
  let body: ReactNode = <Skeleton />

  if (stats && def.isEmpty(stats)) {
    body = <div className="py-1 text-[12px] text-tertiary">{def.empty}</div>
  } else if (stats) {
    body = <def.Body stats={stats} onOpenConversation={onOpenConversation} />
  } else if (failed) {
    body = <div className="py-1 text-[12px] text-amber-400">{t("Couldn't load agent stats")}</div>
  }

  return (
    <section className="@container flex h-full min-w-0 flex-col rounded-lg border border-zGray-800/60 p-3">
      <MetricCardHeader
        def={def}
        card={card}
        note={stats?.capped && def.note ? `${def.note} ${CAPPED}` : def.note}
        showScope={showScope}
        onChange={onChange}
        onRemove={onRemove}
      />
      <div className="flex min-h-0 flex-1 flex-col px-1">{body}</div>
    </section>
  )
}

/** The card's headline number, with its unit and anything that sits beside it. */
export function BigNumber({
  value,
  unit,
  children,
}: {
  value: string | number
  unit?: string
  children?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <span className="flex-none whitespace-nowrap text-[26px] font-semibold leading-none tracking-tight text-main tabular-nums">
        {value}
      </span>
      {unit && (
        <span className="flex-none whitespace-nowrap text-[12px] text-tertiary">{unit}</span>
      )}
      {children}
    </div>
  )
}

/** Up or down against the period before, e.g. "+24%"; nothing when that period was empty. */
export function Change({
  current,
  previous,
  range,
}: {
  current: number
  previous: number
  range: TeamActivityRange
}) {
  const percent = changePercent(current, previous)
  const id = useId()

  if (percent === null) return null
  const compared =
    range === '1d'
      ? t('Compared with the 24 hours before')
      : t('Compared with the {n} days before', { n: range === '7d' ? 7 : 30 })

  return (
    <Tooltip content={compared}>
      {/* A button so the keyboard reaches what the change compares with. */}
      <BaseButton
        aria-describedby={id}
        className={clsx(
          'rounded px-1 py-px text-[10.5px] font-medium tabular-nums bg-zGray-800/40 outline-none focus-visible:ring-1 focus-visible:ring-zGray-600',
          percent > 0 ? 'text-success' : 'text-tertiary',
        )}
      >
        {percent > 0 ? `+${String(percent)}%` : `${String(percent)}%`}
      </BaseButton>
      <span id={id} className="sr-only">
        {compared}
      </span>
    </Tooltip>
  )
}

/** A line under the number. */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('mt-1.5 truncate text-[11.5px] text-tertiary', className)}>{children}</div>
  )
}

/** A session a card names: a link when the viewer may open it, "a private session" otherwise. */
export function SessionName({
  session,
  onOpen,
}: {
  session: AgentStatsSession
  onOpen?: (sessionId: string, title: string) => void
}) {
  if (!session) return <span className="text-tertiary">{t('a private session')}</span>
  const title = session.title || t('Untitled agent')

  if (!onOpen) return <span className="text-secondary">{title}</span>

  return (
    <BaseButton
      onClick={() => onOpen(session.id, session.title)}
      className="max-w-full cursor-pointer truncate text-left text-main underline decoration-zGray-700 underline-offset-2 outline-none transition-colors hover:decoration-current focus-visible:decoration-current"
    >
      {title}
    </BaseButton>
  )
}
