import { useEffect, useLayoutEffect, useState } from 'react'

import type { CSSProperties, RefObject } from 'react'

/** The split pane a summary panel belongs to. */
export const PANE = '[data-workspace-focus-surface="session"]'

/** The titlebar button that opens a pane's panel: the Task summary's, or a Bot chat's name. */
export const TOGGLE = '[data-summary-toggle]'

// Matches the menus' Positioner: 6px under the trigger, end-aligned.
const SIDE_OFFSET = 6
const EDGE = 8
// The transcript keeps at least this much beside the panel, else the panel floats.
const BESIDE_MIN = { list: 600, reply: 800 }

type Edge = { left: number } | { right: number }
type Geometry = { width: number; top: number; edge: Edge; maxHeight: number }

function visible(element: HTMLElement | null | undefined): element is HTMLElement {
  return Boolean(element && element.offsetHeight > 0)
}

// A pane can hold more than one composer surface (a kept-alive view, an edit
// box); the chat's own is the visible one lowest in the pane.
function composerOf(pane: Element | null): HTMLElement | undefined {
  const surfaces = [...(pane?.querySelectorAll<HTMLElement>('.composer-surface') ?? [])]

  return surfaces
    .filter(visible)
    .reduce<HTMLElement | undefined>(
      (lowest, element) =>
        !lowest || element.getBoundingClientRect().top > lowest.getBoundingClientRect().top
          ? element
          : lowest,
      undefined,
    )
}

/** End-aligned with the toggle, as the menus are; a toggle on the pane's left (a Bot's name) aligns the start. */
export function floatingEdge(
  anchor: { left: number; right: number },
  pane: { left: number; width: number } | undefined,
  viewportWidth: number,
): Edge {
  if (pane && anchor.left < pane.left + pane.width / 2) return { left: anchor.left }

  return { right: viewportWidth - anchor.right }
}

function measure(frame: HTMLElement): Geometry {
  const pane = frame.closest(PANE)
  const box = frame.getBoundingClientRect()
  const toggle = pane?.querySelector<HTMLElement>(TOGGLE)
  const anchor = visible(toggle) ? toggle.getBoundingClientRect() : null
  const top = anchor ? anchor.bottom + SIDE_OFFSET : box.top + EDGE
  const edge = anchor
    ? floatingEdge(anchor, pane?.getBoundingClientRect(), window.innerWidth)
    : { right: window.innerWidth - box.right + EDGE }
  const composer = composerOf(pane)
  const bottom = composer ? composer.getBoundingClientRect().top - EDGE : box.bottom - EDGE

  return { width: box.width, top, edge, maxHeight: Math.max(bottom - top, 160) }
}

/**
 * Beside the transcript when the pane has room for both, else floating as a
 * popover under the titlebar toggle, as the titlebar's menus open under theirs,
 * and ending above the composer. `frameRef` is any element filling the area
 * under the header.
 */
export function useSummaryPlacement(
  frameRef: RefObject<HTMLElement | null>,
  selected: boolean,
  docked: boolean,
) {
  const [geometry, setGeometry] = useState<Geometry>()

  useLayoutEffect(() => {
    const frame = frameRef.current

    if (!frame) return
    const update = () => setGeometry(measure(frame))
    const observer = new ResizeObserver(update)
    const pane = frame.closest(PANE)

    observer.observe(frame)
    if (pane) observer.observe(pane)
    const composer = composerOf(pane)

    if (composer) observer.observe(composer)
    window.addEventListener('resize', update)
    update()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [frameRef])

  const min = selected ? BESIDE_MIN.reply : BESIDE_MIN.list
  const floating = docked || (geometry !== undefined && geometry.width < min)
  const style: CSSProperties | undefined =
    floating && geometry
      ? {
          top: geometry.top,
          ...geometry.edge,
          [selected ? 'height' : 'maxHeight']: geometry.maxHeight,
        }
      : undefined

  return { floating, style }
}

// Portaled menus and dialogs opened from the card count as inside it.
const OUTSIDE_EXEMPT = `[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]`

/** A floating panel closes on a press outside it, as a popover does. */
export function useDismissOutside(
  rootRef: RefObject<HTMLElement | null>,
  close: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null

      if (!target || rootRef.current?.contains(target)) return
      if (target.closest(TOGGLE) || target.closest(OUTSIDE_EXEMPT)) return
      close()
    }

    document.addEventListener('pointerdown', onPointerDown, true)

    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [rootRef, close, active])
}
