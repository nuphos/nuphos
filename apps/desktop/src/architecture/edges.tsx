import { BaseEdge, EdgeLabelRenderer, useInternalNode, useReactFlow } from '@xyflow/react'
import { useRef, useState } from 'react'

import type { EdgeProps, InternalNode } from '@xyflow/react'

// Editable orthogonal edge. The route is an S-shape with two right-angle bends
// and one middle segment. A handle sits on the middle segment:
//   - vertical-dominant route  → middle segment is HORIZONTAL → drag it up/down
//   - horizontal-dominant route → middle segment is VERTICAL  → drag it left/right
// The drag stores a perpendicular `offset` on the edge (persisted); 0 = auto.

const CORNER = 8
// Regular `arch` nodes are a FIXED 200×72 (see nodes.tsx). Use those exact dims
// for edge geometry instead of `measured.*` — measurement is undefined for one
// frame after a rebuild (which would put the exit at the node corner) and is
// distorted in the 3D view (CSS scale/rotate skews getBoundingClientRect).
const NODE_W = 200
const NODE_H = 84

// Labels can arrive HTML-escaped (e.g. an agent emitting "&amp;"); show plain text.
function decodeLabel(label: unknown): unknown {
  return typeof label === 'string'
    ? label
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
    : label
}

function box(n: InternalNode) {
  // Groups have an explicit, variable size → trust measurement. Regular nodes
  // are fixed 200×72 → use the constant so the exit is dead-centre even before
  // measurement lands or when the 3D transform skews the measured box.
  const isGroup = n.type === 'archGroup'

  return {
    x: n.internals.positionAbsolute.x,
    y: n.internals.positionAbsolute.y,
    w: isGroup ? (n.measured.width ?? 0) : NODE_W,
    h: isGroup ? (n.measured.height ?? 0) : NODE_H,
  }
}

// Orthogonal path through the points, with small rounded corners at the bends.
function roundedPath(pts: [number, number][], r = CORNER): string {
  if (pts.length < 2) return ''
  let d = `M ${String(pts[0][0])},${String(pts[0][1])}`

  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]
    const [cx, cy] = pts[i]
    const [nx, ny] = pts[i + 1]
    const len1 = Math.hypot(cx - px, cy - py) || 1
    const len2 = Math.hypot(nx - cx, ny - cy) || 1
    const rr = Math.min(r, len1 / 2, len2 / 2)
    const b = [cx - ((cx - px) / len1) * rr, cy - ((cy - py) / len1) * rr]
    const a = [cx + ((nx - cx) / len2) * rr, cy + ((ny - cy) / len2) * rr]

    d += ` L ${String(b[0])},${String(b[1])} Q ${String(cx)},${String(cy)} ${String(a[0])},${String(a[1])}`
  }
  const last = pts[pts.length - 1]

  d += ` L ${String(last[0])},${String(last[1])}`

  return d
}

type EdgeData = { offset?: number; onOffsetChange?: (offset: number) => void }

export function EditableEdge({
  id,
  source,
  target,
  markerEnd,
  style,
  label,
  data,
  selected,
}: EdgeProps) {
  const s = useInternalNode(source)
  const t = useInternalNode(target)
  const { screenToFlowPosition } = useReactFlow()
  const [live, setLive] = useState<number | null>(null)
  // Mirror of `live` for endDrag: the last pointermove's setLive may not be
  // reflected in the `live` closure by the time pointerup fires.
  const liveRef = useRef<number | null>(null)
  const session = useRef<{
    axis: 'x' | 'y'
    base: number
    startX: number
    startY: number
    dragging: boolean
  } | null>(null)

  if (!s || !t) return null
  const sb = box(s)
  const tb = box(t)
  const scx = sb.x + sb.w / 2
  const scy = sb.y + sb.h / 2
  const tcx = tb.x + tb.w / 2
  const tcy = tb.y + tb.h / 2
  const dx = tcx - scx
  const dy = tcy - scy
  // Choose the exit axis by which way the two boxes are actually SEPARATED, not
  // by centre distance. Two nodes can be far apart in x yet OVERLAP in x (one
  // sitting above-and-slightly-beside the other) — there the edge must leave
  // top/bottom, not the side. `gap` is the edge-to-edge distance on each axis
  // (negative = overlapping); route along whichever axis has the real gap.
  const gapX = Math.max(sb.x, tb.x) - Math.min(sb.x + sb.w, tb.x + tb.w)
  const gapY = Math.max(sb.y, tb.y) - Math.min(sb.y + sb.h, tb.y + tb.h)
  const horizontal = gapX >= gapY
  const d = data as EdgeData | undefined
  const offset = live ?? d?.offset ?? 0

  let path: string
  let axis: 'x' | 'y'
  let base: number
  // Label sits at the centre of the middle segment, so it stays ON the line and
  // follows when the segment is dragged.
  let lx: number
  let ly: number

  // Edges leave/enter at the CENTRE of a side and MUST travel straight for at
  // least STUB before the first turn, so the line always pulls cleanly out of
  // the node's centre instead of veering off a corner. `a` is the source-side
  // coord (the exit), `b` the target-side; the exit stub is guaranteed even when
  // the two nodes are so close there isn't room for a stub on both ends.
  const STUB = 34
  const clampMid = (a: number, b: number, v: number) => {
    const lo = Math.min(a, b) + STUB
    const hi = Math.max(a, b) - STUB

    if (hi >= lo) return Math.max(lo, Math.min(hi, v))

    // Too tight to fit a stub on both sides → centre the turn (no overshoot).
    return (a + b) / 2
  }

  // When the two nodes line up on the perpendicular axis the middle segment is
  // degenerate — the route is just a straight line. Drop the two bends and
  // centre the label on it (a stored offset is ignored: a straight edge has no
  // meaningful bend to keep).
  const ALIGN = 1

  if (!horizontal) {
    // vertical dominant → exit top/bottom-centre, horizontal middle segment
    const sy = dy >= 0 ? sb.y + sb.h : sb.y
    const ty = dy >= 0 ? tb.y : tb.y + tb.h

    base = (sy + ty) / 2
    if (Math.abs(tcx - scx) < ALIGN) {
      path = roundedPath([
        [scx, sy],
        [tcx, ty],
      ])
      lx = scx
      ly = (sy + ty) / 2
    } else {
      const midY = clampMid(sy, ty, base + offset)

      path = roundedPath([
        [scx, sy],
        [scx, midY],
        [tcx, midY],
        [tcx, ty],
      ])
      lx = (scx + tcx) / 2
      ly = midY
    }
    axis = 'y'
  } else {
    // horizontal dominant → exit left/right-centre, vertical middle segment
    const sx = dx >= 0 ? sb.x + sb.w : sb.x
    const tx = dx >= 0 ? tb.x : tb.x + tb.w

    base = (sx + tx) / 2
    if (Math.abs(tcy - scy) < ALIGN) {
      path = roundedPath([
        [sx, scy],
        [tx, tcy],
      ])
      lx = (sx + tx) / 2
      ly = scy
    } else {
      const midX = clampMid(sx, tx, base + offset)

      path = roundedPath([
        [sx, scy],
        [midX, scy],
        [midX, tcy],
        [tx, tcy],
      ])
      lx = midX
      ly = (scy + tcy) / 2
    }
    axis = 'x'
  }

  const onPointerDown = (e: React.PointerEvent) => {
    // Do NOT stop propagation or capture yet — a plain click must reach ReactFlow
    // so it can SELECT the edge (which is what enables Backspace/Delete). We only
    // take over once the pointer actually moves (a drag of the middle segment).
    session.current = { axis, base, startX: e.clientX, startY: e.clientY, dragging: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const sess = session.current

    if (!sess) return
    // The primary button is no longer down (release happened off the stroke, or
    // capture was lost) → abandon the session so a later hover move can't enter
    // the drag branch and call setPointerCapture with no active gesture.
    if (e.buttons !== 1) {
      session.current = null
      liveRef.current = null
      setLive(null)

      return
    }
    if (!sess.dragging) {
      if (Math.hypot(e.clientX - sess.startX, e.clientY - sess.startY) < 4) return
      sess.dragging = true
      e.stopPropagation()
      ;(e.target as Element).setPointerCapture(e.pointerId)
    }
    const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const v = sess.axis === 'y' ? flow.y : flow.x
    let off = v - sess.base

    if (Math.abs(off) < 8) off = 0 // snap to a clean, centred straight run
    liveRef.current = off
    setLive(off)
  }
  const endDrag = () => {
    if (session.current?.dragging && liveRef.current !== null) d?.onOffsetChange?.(liveRef.current)
    session.current = null
    liveRef.current = null
    setLive(null)
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={
          selected
            ? { ...style, stroke: 'rgb(var(--color-zViolet-accent))', strokeWidth: 2 }
            : style
        }
      />
      {/* The whole line is draggable (edit mode only): a transparent wide
          hit-area over the path that, when dragged, slides the middle segment
          perpendicular. In Browse / 3D `onOffsetChange` is undefined, so we omit
          the hit area entirely and the edge stays read-only. */}
      {d?.onOffsetChange ? (
        <path
          className="nodrag nopan"
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={18}
          style={{ pointerEvents: 'stroke', cursor: axis === 'x' ? 'ew-resize' : 'ns-resize' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
        />
      ) : null}
      {label ? (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${String(lx)}px, ${String(ly)}px)`,
              background: 'rgb(var(--color-background-base))',
              padding: '1px 5px',
              borderRadius: 4,
              fontSize: 11,
              color: 'rgb(var(--color-text-secondary))',
              userSelect: 'none',
            }}
          >
            {decodeLabel(label) as React.ReactNode}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}
