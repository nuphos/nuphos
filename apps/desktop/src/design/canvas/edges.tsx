import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react'
import { useState } from 'react'

import { decodeText } from './helpers'

import type { EdgeProps } from '@xyflow/react'

export type FlowLinkData = {
  label?: string | null
  onLabelChange?: (label: string) => void
}

const STROKE = 'rgb(var(--color-zViolet-accent))'

/** A flow arrow between two screens, with a label you can edit in place. */
export function FlowLinkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
  data,
}: EdgeProps) {
  const d = (data ?? {}) as FlowLinkData
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })
  const label = decodeText(d.label ?? '')

  const startEditing = () => {
    if (!d.onLabelChange) return
    setDraft(label)
    setEditing(true)
  }
  const finish = () => {
    setEditing(false)
    if (draft.trim() !== label) d.onLabelChange?.(draft.trim())
  }

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke: STROKE, strokeWidth: selected ? 2.5 : 1.75 }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
          onDoubleClick={startEditing}
        >
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={finish}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finish()
                if (e.key === 'Escape') setEditing(false)
                e.stopPropagation()
              }}
              placeholder="Label"
              aria-label="Link label"
              className="h-6 w-36 rounded border border-zViolet-500 bg-main px-2 text-[12px] text-main outline-none focus:ring-1 focus:ring-zViolet-500/60"
            />
          ) : label || selected ? (
            <span
              className="rounded-full border border-main bg-main px-2 py-0.5 text-[12px] text-secondary shadow-sm"
              title="Double-click to edit"
            >
              {label || 'Add label'}
            </span>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
