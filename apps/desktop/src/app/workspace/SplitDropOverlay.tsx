import { clsx } from 'clsx'
import {
  ArrowLeftRight,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  SquareArrowDown,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { PANE_DRAG_TYPE, PREVIEW_PANE, SESSION_DRAG_TYPE, dropZone } from './splitLayout'
import { GLIDE } from './usePaneDropPreview'

import type { DropPreview, DropZone, PaneRect } from './splitLayout'
import type { WorkspaceStore } from './store/workspaceStore'
import type { Dispatch, DragEvent, SetStateAction } from 'react'

type Seed = { sessionId: string; teamId?: string }

/**
 * Covers the panes while a sidebar chat or a pane's grip is dragged, and shows
 * where it would land: an edge splits that side, the middle swaps two panes
 * or replaces the chat. The panes move to where the drop would leave them, so
 * the result is visible before letting go; zones stay on the panes' old places.
 * Other drags (files into the composer) never mount it.
 */
export function SplitDropOverlay({
  rects,
  placed,
  onPreview,
  stores,
  split,
  place,
}: {
  rects: PaneRect[]
  placed: Map<string, PaneRect>
  onPreview: Dispatch<SetStateAction<DropPreview | null>>
  stores: Map<string, WorkspaceStore>
  split: (side: Exclude<DropZone, 'center'>, from: string, seed: Seed) => string | null
  place: (target: string, id: string, zone: DropZone) => void
}) {
  // `pane` is the dragged grip's pane; null for a sidebar chat.
  const [drag, setDrag] = useState<{ pane: string | null } | null>(null)
  const [hover, setHover] = useState<{ rect: PaneRect; zone: DropZone } | null>(null)

  useEffect(() => {
    const start = (event: globalThis.DragEvent) => {
      const types = event.dataTransfer?.types ?? []
      const pane = types.includes(PANE_DRAG_TYPE)
        ? ((event.target as Element).closest<HTMLElement>('[data-workspace-split-pane]')?.dataset
            .workspaceSplitPane ?? null)
        : null

      if (!pane && !types.includes(SESSION_DRAG_TYPE)) return
      // Chromium cancels a drag whose source is covered during dragstart.
      setTimeout(() => setDrag({ pane }))
    }
    const end = () => {
      setDrag(null)
      setHover(null)
      onPreview(null)
    }

    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)

    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [onPreview])

  if (!drag) return null

  const target = (event: DragEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * 100
    const y = ((event.clientY - box.top) / box.height) * 100
    const rect = rects.find(
      (r) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height,
    )

    if (!rect) return null
    const zone = dropZone((x - rect.left) / rect.width, (y - rect.top) / rect.height)

    // A pane never drops on itself; its centre swaps with another pane.
    if (drag.pane && rect.id === drag.pane) return null

    return { rect, zone }
  }
  const drop = (pane: string, zone: DropZone, event: DragEvent) => {
    const raw = event.dataTransfer.getData(SESSION_DRAG_TYPE)
    const seed = raw ? (JSON.parse(raw) as Seed) : null
    // A chat already open in a pane moves with that pane rather than opening twice.
    const moving =
      drag.pane ??
      [...stores].find(([, store]) => {
        const state = store.getState()

        return seed !== null && !state.mainPageOpen && state.sessionId === seed.sessionId
      })?.[0]

    if (moving) place(pane, moving, zone)
    else if (seed && zone === 'center') {
      stores.get(pane)?.actions.selectSession(seed.sessionId, { teamId: seed.teamId })
      place(pane, pane, zone)
    } else if (seed && zone !== 'center') split(zone, pane, seed)
  }

  // Where the moved pane, or the chat's new pane, sits in the previewed layout.
  const landing = hover ? placed.get(drag.pane ?? PREVIEW_PANE) : undefined

  return (
    <div
      className="absolute inset-0 z-50"
      onDragOver={(event) => {
        const next = target(event)

        if (next) event.preventDefault()
        event.dataTransfer.dropEffect = next ? 'move' : 'none'
        setHover((previous) =>
          previous?.rect.id === next?.rect.id && previous?.zone === next?.zone ? previous : next,
        )
        onPreview((previous) =>
          previous?.target === next?.rect.id && previous?.zone === next?.zone
            ? previous
            : next && { target: next.rect.id, zone: next.zone, pane: drag.pane },
        )
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setHover(null)
        onPreview(null)
      }}
      onDrop={(event) => {
        const next = target(event)

        event.preventDefault()
        if (next) drop(next.rect.id, next.zone, event)
      }}
    >
      {drag.pane && <SourceVeil rect={placed.get(drag.pane)} />}
      {hover && landing && (
        <LandingHint rect={landing} zone={hover.zone} movingPane={drag.pane !== null} />
      )}
      {hover && !landing && (
        <ZoneHint rect={hover.rect} zone={hover.zone} movingPane={drag.pane !== null} />
      )}
    </div>
  )
}

const EDGE_HINTS = {
  left: { Icon: PanelLeft, text: 'Split left' },
  right: { Icon: PanelRight, text: 'Split right' },
  top: { Icon: PanelTop, text: 'Split up' },
  bottom: { Icon: PanelBottom, text: 'Split down' },
}

function hintFor(zone: DropZone, movingPane: boolean) {
  if (zone !== 'center') return EDGE_HINTS[zone]

  return movingPane
    ? { Icon: ArrowLeftRight, text: 'Swap' }
    : { Icon: SquareArrowDown, text: 'Open here' }
}

function HintLabel({ zone, movingPane }: { zone: DropZone; movingPane: boolean }) {
  const { Icon, text } = hintFor(zone, movingPane)

  return (
    <span className="flex items-center gap-1.5 rounded-full border border-zGray-700 bg-elevated/95 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-main shadow-lg">
      <Icon className="h-3.5 w-3.5 text-zViolet-300" strokeWidth={1.8} />
      {text}
    </span>
  )
}

/** Outlines the spot the other panes made room for, where letting go will land. */
function LandingHint({
  rect,
  zone,
  movingPane,
}: {
  rect: PaneRect
  zone: DropZone
  movingPane: boolean
}) {
  return (
    <div
      className={clsx(
        'pointer-events-none absolute m-2 flex items-center justify-center rounded-lg border-2 border-dashed border-zViolet-400/70 bg-zViolet-500/10 transition-all',
        GLIDE,
      )}
      style={zoneStyle(rect, 'center')}
    >
      <HintLabel zone={zone} movingPane={movingPane} />
    </div>
  )
}

/** Blurs where the dragged pane would land, and labels what letting go will do there. */
function ZoneHint({
  rect,
  zone,
  movingPane,
}: {
  rect: PaneRect
  zone: DropZone
  movingPane: boolean
}) {
  return (
    <>
      <div
        className="pointer-events-none absolute bg-zGray-950/25 backdrop-blur-[3px] transition-all duration-150"
        style={zoneStyle(rect, zone)}
      />
      <div
        className={clsx(
          'pointer-events-none absolute flex items-center justify-center rounded-lg border border-zViolet-400/70 bg-zViolet-500/10 transition-all duration-150 ease-out',
          zone === 'center' ? 'm-2' : 'm-1.5',
        )}
        style={zoneStyle(rect, zone)}
      >
        <HintLabel zone={zone} movingPane={movingPane} />
      </div>
    </>
  )
}

/** The dragged pane steps back, following it to where it would land. */
function SourceVeil({ rect }: { rect?: PaneRect }) {
  if (!rect) return null

  return (
    <div
      className={clsx('pointer-events-none absolute bg-zGray-950/25 transition-all', GLIDE)}
      style={zoneStyle(rect, 'center')}
    />
  )
}

function zoneStyle({ left, top, width, height }: PaneRect, zone: DropZone) {
  const box = {
    left: { left, top, width: width / 2, height },
    right: { left: left + width / 2, top, width: width / 2, height },
    top: { left, top, width, height: height / 2 },
    bottom: { left, top: top + height / 2, width, height: height / 2 },
    center: { left, top, width, height },
  }[zone]

  return {
    left: `${String(box.left)}%`,
    top: `${String(box.top)}%`,
    width: `${String(box.width)}%`,
    height: `${String(box.height)}%`,
  }
}
