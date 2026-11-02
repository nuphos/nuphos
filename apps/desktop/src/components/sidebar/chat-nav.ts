import { rowIndicator } from '../../lib/subAgentState.ts'

import { nestItems } from './nest-items.ts'

import type { Item, Section } from './types'
import type { RuntimeExecution } from '../../lib/runtimeExecution.ts'

/** ⌥↑ / ⌥↓ step through chat rows; with ⇧ they only stop at rows needing attention. */
export function chatNavKey(
  event: Pick<
    KeyboardEvent,
    'key' | 'altKey' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'isComposing' | 'defaultPrevented'
  >,
): { step: 1 | -1; attentionOnly: boolean } | null {
  // An editor or terminal that claimed the key (Monaco's move-line, xterm) keeps it.
  if (event.defaultPrevented || event.isComposing) return null
  if (!event.altKey || event.metaKey || event.ctrlKey) return null
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return null

  return { step: event.key === 'ArrowDown' ? 1 : -1, attentionOnly: event.shiftKey }
}

/** A row showing its dot or the error mark. */
export function chatRowNeedsAttention(
  item: Pick<Item, 'dot'>,
  runtimeState: RuntimeExecution | undefined,
): boolean {
  const indicator = rowIndicator(runtimeState, item.dot ?? null)

  return indicator === 'unread' || indicator === 'waiting' || indicator === 'error'
}

/**
 * The chat row a step lands on, in the order the sidebar shows them: rows in
 * collapsed groups or under a folded parent are skipped, and a folded parent
 * stands in for the open thread it hides. Stops at either end.
 */
export function chatRowToward(
  sections: readonly Section[],
  isCollapsed: (section: Pick<Section, 'title' | 'defaultCollapsed'>) => boolean,
  step: 1 | -1,
  eligible: (item: Item) => boolean = () => true,
): Item | undefined {
  const rows = sections
    .filter((section) => !section.title || !isCollapsed(section))
    .flatMap((section) => nestItems(section.items, (key) => isCollapsed({ title: key })))
    .filter(({ item }) => item.key.startsWith('agent-session:'))
  const current = rows.findIndex(
    ({ item, hidden }) => item.active === true || hidden.some((row) => row.active),
  )
  const edge = step === 1 ? -1 : rows.length
  const start = current === -1 ? edge : current

  for (let i = start + step; i >= 0 && i < rows.length; i += step) {
    // A folded parent shows what the rows it hides show.
    if (eligible(rows[i].item) || rows[i].hidden.some(eligible)) return rows[i].item
  }

  return undefined
}
