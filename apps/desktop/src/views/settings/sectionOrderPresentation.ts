/** The Agents page's top-level sections, in their default order. */
export const AGENT_SECTION_IDS = ['boxes', 'usage', 'agents'] as const

export type AgentSectionId = (typeof AGENT_SECTION_IDS)[number]

export const AGENT_SECTION_LABELS: Record<AgentSectionId, string> = {
  boxes: 'Computers',
  usage: 'Subscription usage',
  agents: 'Runtimes',
}

const STORAGE_PREFIX = 'nuphos.agentsPageOrder.v1:'

/** One saved order per person and team, so a shared computer keeps them apart. */
export function sectionOrderStorageKey(userId: string, teamId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(userId)}|${encodeURIComponent(teamId)}`
}

/**
 * A saved order made safe to render: ids this build no longer has are dropped,
 * duplicates keep their first place, and sections the saved order never knew
 * about take their default place after the default section before them.
 */
export function normalizeSectionOrder<T extends string>(
  saved: unknown,
  defaults: readonly T[],
): T[] {
  if (!Array.isArray(saved)) return [...defaults]
  const known = new Set<string>(defaults)
  const order: T[] = []

  for (const id of saved) {
    if (typeof id === 'string' && known.has(id) && !order.includes(id as T)) order.push(id as T)
  }
  defaults.forEach((id, index) => {
    if (order.includes(id)) return
    const previous = index === 0 ? -1 : order.indexOf(defaults[index - 1])

    order.splice(previous + 1, 0, id)
  })

  return order
}

/** Reads a stored order; anything unreadable falls back to the defaults. */
export function parseSectionOrder<T extends string>(
  raw: string | null,
  defaults: readonly T[],
): T[] {
  if (raw === null) return [...defaults]
  try {
    return normalizeSectionOrder(JSON.parse(raw) as unknown, defaults)
  } catch {
    return [...defaults]
  }
}

/** The part of `localStorage` the saved order needs, so tests can pass a fake. */
export type OrderStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** The saved order under `key`, or the defaults when nothing usable is there. */
export function readSectionOrder<T extends string>(
  storage: OrderStorage | null,
  key: string,
  defaults: readonly T[],
): T[] {
  try {
    return parseSectionOrder(storage?.getItem(key) ?? null, defaults)
  } catch {
    return [...defaults]
  }
}

/**
 * Saves an order, or removes the key when it matches the defaults, so a person who
 * never moved anything (or reset) keeps following the default as it changes.
 */
export function writeSectionOrder<T extends string>(
  storage: OrderStorage | null,
  key: string,
  order: readonly T[],
  defaults: readonly T[],
) {
  try {
    if (order.join() === defaults.join()) storage?.removeItem(key)
    else storage?.setItem(key, JSON.stringify(order))
  } catch {
    // A full or blocked storage only costs the order on the next launch.
  }
}

/** Moves `id` to just before `beforeId`, or to the end when that is null. */
export function moveSection<T extends string>(order: readonly T[], id: T, beforeId: T | null): T[] {
  if (id === beforeId || !order.includes(id)) return [...order]
  const rest = order.filter((entry) => entry !== id)
  const at = beforeId === null ? -1 : rest.indexOf(beforeId)

  rest.splice(at === -1 ? rest.length : at, 0, id)

  return rest
}

/**
 * The section a drop or a step should land in front of, from the indexes of the
 * sections on screen. Hidden sections keep their place in the full order.
 */
export function beforeIdAt<T extends string>(visible: readonly T[], index: number): T | null {
  return visible[index] ?? null
}

/** Where a pointer at `pointerY` drops, from each visible section's top and height. */
export function dropIndexAt(
  pointerY: number,
  blocks: readonly { top: number; height: number }[],
): number {
  const index = blocks.findIndex((block) => pointerY < block.top + block.height / 2)

  return index === -1 ? blocks.length : index
}

/** A drop right above or below the dragged section would leave it where it is. */
export function isNoopDrop(fromIndex: number, dropIndex: number): boolean {
  return dropIndex === fromIndex || dropIndex === fromIndex + 1
}

/** Read out after a move so screen reader users hear where the section went. */
export function moveAnnouncement(label: string, position: number, total: number): string {
  return `${label} moved to position ${String(position)} of ${String(total)}`
}

/**
 * Whether the grip's menu may take an open request. Base UI opens a menu on
 * mousedown, which would pop it at the start of every drag, so a pointer opens it
 * on click instead (`gripClickOpens`); Alt+Arrow moves rather than opening it.
 */
export function gripMenuAcceptsOpen(event: { type: string; altKey?: boolean }): boolean {
  return event.type !== 'mousedown' && !(event.type === 'keydown' && event.altKey === true)
}

/**
 * A pointer click opens the menu, unless the press closed it a moment ago. A
 * keyboard click (`detail` 0) is left to Base UI.
 */
export function gripClickOpens(detail: number, openAtPress: boolean): boolean {
  return detail > 0 && !openAtPress
}

/** The step Alt+Up or Alt+Down asks for on a focused grip, else null. */
export function gripKeyStep(event: { key: string; altKey: boolean }): -1 | 1 | null {
  if (!event.altKey) return null
  if (event.key === 'ArrowUp') return -1
  if (event.key === 'ArrowDown') return 1

  return null
}
