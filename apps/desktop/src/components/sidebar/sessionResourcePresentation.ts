import type { SessionResource } from '../../api/session-resource-types'
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
  checks_failed: 'checks failing',
  changes_requested: 'changes requested',
  conflict: 'merge conflict',
} as const

/** A resource's state as a person would say it, e.g. `open · checks failing`. */
export function resourceStatus(resource: SessionResource): string {
  return resource.state === 'open' && resource.health
    ? `open · ${HEALTH_TEXT[resource.health]}`
    : resource.state
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
