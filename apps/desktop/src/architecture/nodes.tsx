import { Handle, NodeResizer, Position } from '@xyflow/react'
import { useState } from 'react'

import type { NodeProps } from '@xyflow/react'

// Category -> accent color. `kind` is a freeform string (see schema), these are
// just the defaults the renderer knows about; unknown kinds fall back to gray.
const KIND_COLOR: Record<string, string> = {
  cloud: '#1D9E75',
  code: '#7F77DD',
  abstract: '#888780',
}

// App primary (zViolet-500). Used for selection/active accents so the feature
// matches the rest of the UI instead of an off-brand blue.
const PRIMARY = 'rgb(var(--color-zViolet-500))'

export type ArchFlowNodeData = {
  label: string
  kind?: string
  /** Pre-formatted "provider · type" string, or undefined for abstract nodes. */
  resourceLabel?: string
  /** View-local accent override. */
  color?: string
  /** Has a `url` → clickable to jump (used for the browse-mode affordance). */
  hasUrl?: boolean
}

export function ArchFlowNode({ data, selected, isConnectable }: NodeProps) {
  const d = data as ArchFlowNodeData
  const accent = d.color || KIND_COLOR[d.kind ?? 'abstract'] || KIND_COLOR.abstract
  const [hover, setHover] = useState(false)
  // In browse mode (not connectable) a node with a url is clickable → jumps.
  // Give it a pointer + hover highlight so it reads as actionable.
  const clickable = !isConnectable && !!d.hasUrl
  // Connection handles on all four sides. They must ALWAYS be in the DOM — even
  // when not connectable — because ReactFlow anchors edges to them; removing
  // them makes every edge vanish. So we only toggle their VISIBILITY: shown when
  // the node is hovered AND editing (isConnectable), invisible otherwise.
  // connectionMode="loose" (see Canvas) lets a drag start/end on any of them.
  const handleStyle: React.CSSProperties = {
    width: 7,
    height: 7,
    border: 'none',
    background: 'rgb(var(--color-zGray-500))',
    opacity: hover && isConnectable ? 1 : 0,
    transition: 'opacity 120ms ease',
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        // FIXED width AND height so the backend can reason about node extents
        // exactly (it enforces non-overlap). Same width also means same x =>
        // same centre, enabling straight vertical edges. Height fits a 2-line
        // label PLUS the subtitle without clipping (must match NODE_H in
        // edges.tsx and the backend diagram-geometry).
        width: 200,
        height: 84,
        boxSizing: 'border-box',
        padding: '8px 11px',
        borderRadius: 8,
        background: 'rgb(var(--color-background-elevated))',
        border: selected
          ? `2px solid ${PRIMARY}`
          : clickable && hover
            ? '1px solid rgb(var(--color-zViolet-accent))'
            : '1px solid rgb(var(--color-border))',
        boxShadow: selected
          ? 'none'
          : clickable && hover
            ? '0 2px 10px rgba(0,0,0,0.16)'
            : '0 1px 2px rgba(0,0,0,0.04)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        overflow: 'hidden',
        userSelect: 'none',
        cursor: 'default',
        transition: 'border-color 120ms ease, box-shadow 120ms ease',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        isConnectable={isConnectable}
        style={handleStyle}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        isConnectable={isConnectable}
        style={handleStyle}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: accent,
            flex: 'none',
          }}
        />
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'rgb(var(--color-text-base))',
            lineHeight: 1.25,
            flex: 1,
            minWidth: 0,
            overflowWrap: 'anywhere',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {d.label || 'Untitled'}
        </span>
      </div>
      {d.resourceLabel ? (
        <div
          style={{
            fontSize: 11,
            color: 'rgb(var(--color-text-tertiary))',
            marginTop: 3,
            paddingLeft: 15,
          }}
        >
          {d.resourceLabel}
        </div>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        isConnectable={isConnectable}
        style={handleStyle}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        isConnectable={isConnectable}
        style={handleStyle}
      />
    </div>
  )
}

export type ArchGroupNodeData = {
  label: string
  resourceLabel?: string
  /** Edit mode: show resize handles + let the whole body be grabbed to move. */
  editing?: boolean
  /** Commit a finished resize (new size + top-left position) back to `diagram`. */
  onResizeEnd?: (
    size: { width: number; height: number },
    position: { x: number; y: number },
  ) => void
}

// Container/boundary node (VPC, cluster, namespace). Fills its node box (sized by
// ReactFlow via style width/height) and shows a header label; children render on
// top via ReactFlow's parent/child ordering.
export function ArchGroupNode({ data, selected }: NodeProps) {
  const d = data as ArchGroupNodeData

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 10,
        // zViolet-accent (lighter) instead of -500 so the boundary + label read
        // on both the light and dark canvas.
        border: selected
          ? `2px solid ${PRIMARY}`
          : '1.5px dashed rgba(var(--color-zViolet-accent), 0.5)',
        background: 'rgba(var(--color-zViolet-accent), 0.06)',
        boxSizing: 'border-box',
        userSelect: 'none',
      }}
    >
      {d.editing ? (
        <NodeResizer
          isVisible={selected}
          color={PRIMARY}
          minWidth={120}
          minHeight={90}
          onResizeEnd={(_e, p) =>
            d.onResizeEnd?.({ width: p.width, height: p.height }, { x: p.x, y: p.y })
          }
        />
      ) : null}
      <div
        style={{
          // The group BODY is pointer-events:none (set on the node wrapper) so
          // clicks pass through to edges/nodes inside it. Only this header is
          // interactive — grab it to select/move the group.
          pointerEvents: 'auto',
          display: 'inline-flex',
          padding: '7px 12px',
          fontSize: 12.5,
          fontWeight: 500,
          color: 'rgb(var(--color-zViolet-accent))',
          alignItems: 'baseline',
          gap: 8,
          cursor: 'grab',
        }}
      >
        <span>{d.label || 'Group'}</span>
        {d.resourceLabel ? (
          <span
            style={{
              fontSize: 11,
              color: 'rgba(var(--color-zViolet-accent), 0.8)',
              fontWeight: 400,
            }}
          >
            {d.resourceLabel}
          </span>
        ) : null}
      </div>
    </div>
  )
}
