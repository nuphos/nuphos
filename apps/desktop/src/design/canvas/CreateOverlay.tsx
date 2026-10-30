import { useReactFlow, useViewport } from '@xyflow/react'
import { useRef, useState } from 'react'

import { PRIMARY } from './helpers'

import type { Tool } from './tools'
import type { PointerEvent as ReactPointerEvent } from 'react'

type Point = { x: number; y: number }

export type Placement = {
  x: number
  y: number
  width: number
  height: number
  dragged: boolean
  /** Where the drag began and ended, for shapes that have a direction. */
  start: Point
  end: Point
}

type Props = {
  tool: Exclude<Tool, 'select' | 'hand'>
  inkColor: string
  /** A box tool finished: a drag gives the box; a click gives `dragged: false` and a point. */
  onPlace: (placement: Placement) => void
  /** The pen lifted: points are in canvas units, absolute. */
  onStroke: (points: Point[]) => void
  onBusy: (busy: boolean) => void
}

const MIN_DRAG = 4

/**
 * Sits over the canvas while a creation tool is active: captures the pointer,
 * previews the box or stroke being drawn, and hands the result back in canvas
 * coordinates.
 */
export function CreateOverlay({ tool, inkColor, onPlace, onStroke, onBusy }: Props) {
  const { screenToFlowPosition } = useReactFlow()
  const viewport = useViewport()
  const start = useRef<Point | null>(null)
  const [box, setBox] = useState<Placement | null>(null)
  const [stroke, setStroke] = useState<Point[]>([])

  const toFlow = (e: ReactPointerEvent) => screenToFlowPosition({ x: e.clientX, y: e.clientY })
  const toScreen = (p: Point) => ({
    x: p.x * viewport.zoom + viewport.x,
    y: p.y * viewport.zoom + viewport.y,
  })

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toFlow(e)

    start.current = p
    onBusy(true)
    if (tool === 'pen') setStroke([p])
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current

    if (!s) return
    const p = toFlow(e)

    if (tool === 'pen') {
      setStroke((pts) => [...pts, p])

      return
    }
    setBox({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      width: Math.abs(p.x - s.x),
      height: Math.abs(p.y - s.y),
      dragged: Math.hypot(p.x - s.x, p.y - s.y) > MIN_DRAG,
      start: s,
      end: p,
    })
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current

    start.current = null
    onBusy(false)
    if (!s) return
    const p = toFlow(e)

    if (tool === 'pen') {
      const points = stroke.length > 1 ? stroke : [s, p]

      setStroke([])
      onStroke(points)

      return
    }
    const dragged = Math.hypot(p.x - s.x, p.y - s.y) > MIN_DRAG

    setBox(null)
    onPlace({
      x: dragged ? Math.min(s.x, p.x) : s.x,
      y: dragged ? Math.min(s.y, p.y) : s.y,
      width: Math.abs(p.x - s.x),
      height: Math.abs(p.y - s.y),
      dragged,
      start: s,
      end: p,
    })
  }

  const screenBox =
    box && box.dragged
      ? { ...toScreen(box), w: box.width * viewport.zoom, h: box.height * viewport.zoom }
      : null

  return (
    <div
      className="absolute inset-0 z-[5]"
      style={{ cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null
        setBox(null)
        setStroke([])
        onBusy(false)
      }}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        {screenBox && (
          <rect
            x={screenBox.x}
            y={screenBox.y}
            width={screenBox.w}
            height={screenBox.h}
            fill={`color-mix(in srgb, ${PRIMARY} 8%, transparent)`}
            stroke={PRIMARY}
            strokeDasharray="6 4"
            strokeWidth={1.5}
          />
        )}
        {stroke.length > 1 && (
          <path
            d={stroke
              .map((p, i) => {
                const s = toScreen(p)

                return `${i === 0 ? 'M' : 'L'} ${String(s.x)} ${String(s.y)}`
              })
              .join(' ')}
            fill="none"
            stroke={inkColor}
            strokeWidth={3 * viewport.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  )
}
