import { GRID_COLUMNS, overlaps } from './homeWidgetSettings.ts'

import type { HomeGridItem } from '../../../types/team.ts'

const readingOrder = (a: HomeGridItem, b: HomeGridItem) => a.y - b.y || a.x - b.x

/** The cards as they read on the grid: row by row, left to right. */
export function cardsInReadingOrder<T extends HomeGridItem>(grid: readonly T[]): T[] {
  return [...grid].sort(readingOrder)
}

/** The first spot for `card` that is free in `taken`, at or after `from`. */
function nextFreeSpot<T extends HomeGridItem>(
  taken: HomeGridItem[],
  card: T,
  from: { x: number; y: number },
): T {
  const w = Math.min(card.w, GRID_COLUMNS)

  for (let y = from.y; ; y++) {
    for (let x = y === from.y ? from.x : 0; x + w <= GRID_COLUMNS; x++) {
      const spot = { ...card, w, x, y }

      if (!taken.some((other) => overlaps(other, spot))) return spot
    }
  }
}

/** Places `order` one after another, each in the first free spot after the one before. */
function flow<T extends HomeGridItem>(order: T[]): T[] {
  const placed: T[] = []
  let cursor = { x: 0, y: 0 }

  for (const card of order) {
    const spot = nextFreeSpot(placed, card, cursor)

    placed.push(spot)
    cursor = { x: spot.x + spot.w, y: spot.y }
  }

  return placed
}

/**
 * The grid with its gaps closed, as in Notion: the cards keep their reading
 * order and size and flow again from the top, each in the first free spot
 * after the one before it. Overlapping cards, as in a grid mid-drag, are
 * moved apart the same way. The cards come back in reading order.
 */
export function compactGrid<T extends HomeGridItem>(grid: readonly T[]): T[] {
  return flow(cardsInReadingOrder(grid))
}

/**
 * The grid while card `id` is dragged, compacted as compactGrid does. The other
 * cards keep their reading order from before the drag (`before`, by id), so
 * the cards the library pushes aside cannot swap places, and flow without the
 * dragged card. It goes in before the first of them at or after its top left
 * corner, so dropping a card onto another's place puts it there.
 */
export function compactAround<T extends HomeGridItem>(
  grid: readonly T[],
  id: string,
  before: readonly string[],
): T[] {
  const card = grid.find((item) => item.i === id)

  if (!card) return compactGrid(grid)
  const rank = (item: T) => {
    const at = before.indexOf(item.i)

    return at === -1 ? before.length : at
  }
  const others = flow(grid.filter((item) => item.i !== id).sort((a, b) => rank(a) - rank(b)))
  const at = others.findIndex((other) => readingOrder(other, card) >= 0)

  others.splice(at === -1 ? others.length : at, 0, card)

  return flow(others)
}

/**
 * The grid after moving card `id` one place earlier (-1) or later (1) in
 * reading order, so it trades places with its neighbour, then compacted as
 * compactGrid does. Unchanged when there is no place to move to.
 */
export function moveCard(grid: HomeGridItem[], id: string, step: -1 | 1): HomeGridItem[] {
  const order = cardsInReadingOrder(grid)
  const from = order.findIndex((item) => item.i === id)
  const to = from + step

  if (from === -1 || to < 0 || to >= order.length) return grid
  const moved = order[from]

  order[from] = order[to]
  order[to] = moved

  return flow(order)
}
