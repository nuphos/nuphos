import { locale, t } from '../../i18n/index.ts'

import type { SessionResource } from '../../api/session-resource-types'
import type { ChangesFilter } from '../../lib/chatSummaryPanel'
import type { TerminalProcess } from '../../lib/sessionTerminalProcesses'

export type ResourceChip =
  | { kind: 'resource'; key: string; resource: SessionResource }
  | { kind: 'terminal'; key: string; terminal: TerminalProcess }
  | { kind: 'terminals'; key: string; terminals: TerminalProcess[] }

/** What a chip says: a PR number, a thread's title, or an issue's identifier. */
export function resourceLabel(resource: SessionResource): string {
  if (resource.provider === 'github') return `#${String(resource.number)}`
  if (resource.provider === 'slack' || resource.provider === 'discord') return resource.title

  return resource.title.split(/\s+/, 1)[0]
}

const HEALTH_TEXT = {
  checks_failed: t('open · checks failing'),
  changes_requested: t('open · changes requested'),
  conflict: t('open · merge conflict'),
}

/** What holds up an open PR. A merged or closed PR's last health no longer applies. */
export function resourceHealth(resource: SessionResource) {
  return resource.provider === 'github' && resource.state === 'open'
    ? (resource.health ?? null)
    : null
}

/** A resource's state as a person would say it, e.g. `open · checks failing`. */
export function resourceStatus(resource: SessionResource): string {
  const health = resourceHealth(resource)

  return health ? HEALTH_TEXT[health] : resource.state
}

/** A PR tag's color is its GitHub state alone, as on GitHub: open green, merged purple, closed red. */
export function pullStateColor(resource: SessionResource) {
  if (resource.state === 'merged') return 'session-resource-merged'
  if (resource.state === 'closed') return 'session-resource-closed'

  return 'session-resource-open'
}

/**
 * Where a pull request or issue stands, as the Changes filter and the merged
 * badge group them: still open, merged (or a completed issue), or closed
 * unmerged (or a canceled issue). A chat thread is always open.
 */
export type ChangeStatus = 'open' | 'merged' | 'closed'

export function changeStatus(resource: SessionResource): ChangeStatus {
  if (resource.provider === 'linear') {
    if (resource.stateType === 'completed') return 'merged'

    return resource.stateType === 'canceled' ? 'closed' : 'open'
  }
  if (resource.provider !== 'github') return 'open'
  if (resource.state === 'merged') return 'merged'

  return resource.state === 'closed' ? 'closed' : 'open'
}

const HEALTH_MARK = {
  checks_failed: { glyph: 'cross', color: 'session-resource-failing' },
  changes_requested: { glyph: 'dot', color: 'session-resource-pending' },
  conflict: { glyph: 'conflict', color: 'session-resource-pending' },
} as const

/**
 * The status mark beside an open PR's tag, kept apart from its state color the
 * way GitHub shows checks next to a PR: a red cross for failing checks, a
 * yellow dot for requested changes, a conflict marker for a conflict.
 */
export function resourceMark(resource: SessionResource) {
  const health = resourceHealth(resource)

  return health ? HEALTH_MARK[health] : null
}

/** The whole name, as a list shows it: a PR's number and title, or anything else's title. */
export function resourceFullLabel(resource: SessionResource): string {
  return resource.provider === 'github'
    ? `${resourceLabel(resource)} ${resource.title}`
    : resource.title
}

/** Every name the chips stand for, one per line in a tooltip. */
export function chipNames(chips: ResourceChip[]): string[] {
  return chips.flatMap((chip) => {
    if (chip.kind === 'resource') return [resourceFullLabel(chip.resource)]
    if (chip.kind === 'terminal') return [chip.terminal.name]

    return chip.terminals.map((terminal) => terminal.name)
  })
}

type FinishedWord = 'merged' | 'done' | 'closed' | 'canceled'

/** How the merged badge names one finished item: a PR merged or closed, an issue done or canceled. */
function finishedWord(resource: SessionResource): FinishedWord {
  const merged = changeStatus(resource) === 'merged'

  if (resource.provider === 'linear') return merged ? 'done' : 'canceled'

  return merged ? 'merged' : 'closed'
}

/** A count of finished items as the badge says it, e.g. `15 merged`. */
function finishedCount(word: FinishedWord, n: number): string {
  if (word === 'merged') return n === 1 ? t('1 merged') : t('{n} merged', { n })
  if (word === 'done') return n === 1 ? t('1 done') : t('{n} done', { n })
  if (word === 'closed') return n === 1 ? t('1 closed') : t('{n} closed', { n })

  return n === 1 ? t('1 canceled') : t('{n} canceled', { n })
}

/**
 * What the merged badge says, the count on the Changes pill it opens: merged
 * PRs and completed issues as `13 merged` (`2 done` when none is a PR), or
 * when nothing merged, the closed and canceled ones as `1 closed`.
 */
export function finishedLabel(resources: SessionResource[]): string {
  const merged = resources.filter((resource) => changeStatus(resource) === 'merged')

  if (!merged.length) return finishedCount('closed', resources.length)
  const word = merged.some((resource) => resource.provider === 'github') ? 'merged' : 'done'

  return finishedCount(word, merged.length)
}

/**
 * How the finished items break down, most common first, listed the way the
 * app's language lists things: `15 merged, 2 closed, 1 done` in English.
 */
export function finishedBreakdown(resources: SessionResource[], language: string = locale): string {
  const counts = new Map<FinishedWord, number>()

  for (const resource of resources) {
    const word = finishedWord(resource)

    counts.set(word, (counts.get(word) ?? 0) + 1)
  }

  const items = [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([word, count]) => finishedCount(word, count))

  return new Intl.ListFormat(language, { style: 'narrow', type: 'conjunction' }).format(items)
}

/** The merged badge's tooltip: its breakdown, then one name per line. */
export function finishedTooltip(resources: SessionResource[]): string {
  return [finishedBreakdown(resources), ...resources.map(resourceFullLabel)].join('\n')
}

/** The Changes filter the merged badge opens: Merged when it holds anything merged, else Closed. */
export function finishedFilter(resources: SessionResource[]): ChangesFilter {
  return resources.some((resource) => changeStatus(resource) === 'merged') ? 'merged' : 'closed'
}

/**
 * One chip per linked resource. Open terminals are interchangeable shells, so
 * two or more share a single chip that lists them, leaving room for the links.
 */
export function resourceChips(
  resources: SessionResource[],
  terminals: TerminalProcess[],
): ResourceChip[] {
  const chips: ResourceChip[] = resources.map((resource) => ({
    kind: 'resource',
    key: resource.id,
    resource,
  }))

  if (terminals.length > 1) chips.push({ kind: 'terminals', key: 'terminals', terminals })
  else if (terminals.length === 1)
    chips.push({ kind: 'terminal', key: terminals[0].tabId, terminal: terminals[0] })

  return chips
}

/**
 * How many leading chips fit in `available` pixels. When some do not, the
 * shown ones also leave room for the "+N" chip, so the last chips fold into it
 * first and a narrow row is "+N" alone. A lone chip never becomes "+1": the
 * titlebar keeps it whole (see `minimumRowWidth`), and a sidebar row narrower
 * than it truncates its label.
 */
export function fittingChipCount(
  widths: number[],
  available: number,
  gap: number,
  overflowWidth: number,
): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1)

  if (total <= available) return widths.length

  let used = overflowWidth
  let count = 0

  for (const width of widths) {
    used += width + gap
    if (used > available) break
    count += 1
  }

  return widths.length === 1 ? 1 : count
}

/** The narrowest a row can get: its "+N" chip, or its only chip at full width. */
export function minimumRowWidth(widths: number[], overflowWidth: number): number {
  return widths.length > 1 ? overflowWidth : (widths[0] ?? 0)
}
