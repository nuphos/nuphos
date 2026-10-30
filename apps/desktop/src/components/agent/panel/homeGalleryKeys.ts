import { useLayoutEffect, useState } from 'react'

import type { RefObject } from 'react'

const top = (el: HTMLElement) => el.getBoundingClientRect().top
const left = (el: HTMLElement) => el.getBoundingClientRect().left

/** The tile above or below `from`: the nearest row that way, then the nearest column. */
function verticalNeighbour(
  tiles: HTMLElement[],
  from: HTMLElement,
  sign: 1 | -1,
): HTMLElement | undefined {
  const rows = (el: HTMLElement) => (top(el) - top(from)) * sign
  const columns = (el: HTMLElement) => Math.abs(left(el) - left(from))

  return tiles
    .filter((el) => rows(el) > 1)
    .toSorted((a, b) => rows(a) - rows(b) || columns(a) - columns(b))[0]
}

/**
 * Moves focus between the gallery's tiles (`[data-tile]` in `container`) for
 * an arrow key, Home or End: left and right by one, up and down to the
 * nearest tile in the row above or below. Returns whether the key moved focus.
 */
export function moveTileFocus(container: HTMLElement, key: string): boolean {
  const tiles = [...container.querySelectorAll<HTMLElement>('[data-tile]')]
  const current = tiles.indexOf(document.activeElement as HTMLElement)

  if (current < 0) return false
  const from = tiles[current]
  const targets: Record<string, (() => HTMLElement | undefined) | undefined> = {
    ArrowRight: () => tiles[current + 1],
    ArrowLeft: () => tiles[current - 1],
    ArrowDown: () => verticalNeighbour(tiles, from, 1),
    ArrowUp: () => verticalNeighbour(tiles, from, -1),
    Home: () => tiles[0],
    End: () => tiles.at(-1),
  }
  const find = targets[key]

  if (!find) return false
  const target = find()

  target?.focus()
  target?.scrollIntoView({ block: 'nearest' })

  return true
}

/**
 * The tab an arrow key, Home or End moves to from tab `index` of `count`, or
 * null for any other key. Both arrow axes work, as the tabs run down the side
 * of a wide gallery and across the top of a narrow one.
 */
export function tabStep(key: string, index: number, count: number): number | null {
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[key]

  return step === undefined ? null : Math.min(count - 1, Math.max(0, index + step))
}

/**
 * Which way a row of tabs runs, read from its flex direction and kept up to
 * date as the gallery is resized: down the side, or across the top when narrow.
 */
export function useTabsOrientation(ref: RefObject<HTMLElement | null>): 'horizontal' | 'vertical' {
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('vertical')

  useLayoutEffect(() => {
    const el = ref.current

    if (!el) return
    const update = () =>
      setOrientation(getComputedStyle(el).flexDirection === 'column' ? 'vertical' : 'horizontal')
    // The tabs change size whenever they switch between a column and a row.
    const observer = new ResizeObserver(update)

    update()
    observer.observe(el)

    return () => observer.disconnect()
  }, [ref])

  return orientation
}
