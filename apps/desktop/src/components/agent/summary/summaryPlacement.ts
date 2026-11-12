import { useEffect, useLayoutEffect, useState } from 'react'

import { t } from '../../../i18n'
import { setChatSummaryOpen } from '../../../lib/chatSummaryPanel'

import type { CSSProperties, RefObject } from 'react'

/** The split pane a summary panel belongs to. */
export const PANE = '[data-workspace-focus-surface="session"]'

export const TOGGLE = () => `[aria-label="${CSS.escape(t('Toggle agent summary'))}"]`

// Matches the menus' Positioner: 6px under the trigger, end-aligned.
const SIDE_OFFSET = 6
const EDGE = 8
// The transcript keeps at least this much beside the panel, else the panel floats.
const BESIDE_MIN = { list: 600, reply: 800 }

type Geometry = { width: number; top: number; right: number; maxHeight: number }

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

function measure(frame: HTMLElement): Geometry {
  const pane = frame.closest(PANE)
  const box = frame.getBoundingClientRect()
  const toggle = pane?.querySelector<HTMLElement>(TOGGLE())
  const anchor = visible(toggle) ? toggle.getBoundingClientRect() : null
  const top = anchor ? anchor.bottom + SIDE_OFFSET : box.top + EDGE
  const right = window.innerWidth - (anchor ? anchor.right : box.right - EDGE)
  const composer = composerOf(pane)
  const bottom = composer ? composer.getBoundingClientRect().top - EDGE : box.bottom - EDGE

  return { width: box.width, top, right, maxHeight: Math.max(bottom - top, 160) }
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
          right: geometry.right,
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
  paneId: string,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null

      if (!target || rootRef.current?.contains(target)) return
      if (target.closest(TOGGLE()) || target.closest(OUTSIDE_EXEMPT)) return
      setChatSummaryOpen(paneId, false)
    }

    document.addEventListener('pointerdown', onPointerDown, true)

    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [rootRef, paneId, active])
}
