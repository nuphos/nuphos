import { NodeResizer } from '@xyflow/react'

import { useDesignCanvas } from './context'
import { DEFAULT_INK, PRIMARY } from './helpers'
import { TextEditor } from './nodeParts'

import type { DesignNodeData } from './nodeParts'
import type { DesignInk, DesignShape } from '../schema'
import type { NodeProps } from '@xyflow/react'

// --- Ink and shapes ---------------------------------------------------------

export function InkNode({ data, selected }: NodeProps) {
  const { object: ink } = data as DesignNodeData<DesignInk>
  const width = Math.max(ink.width, 1)
  const height = Math.max(ink.height, 1)
  const d = ink.points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${String(x)} ${String(y)}`)
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      style={{ overflow: 'visible', display: 'block' }}
    >
      <path
        d={d}
        fill="none"
        stroke={ink.color || DEFAULT_INK}
        strokeWidth={ink.strokeWidth ?? 3}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'stroke' }}
      />
      {selected && (
        <path
          d={d}
          fill="none"
          stroke={PRIMARY}
          strokeOpacity={0.35}
          strokeWidth={(ink.strokeWidth ?? 3) + 6}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </svg>
  )
}

export function ShapeNode({ data, selected }: NodeProps) {
  const { object: shape } = data as DesignNodeData<DesignShape>
  const canvas = useDesignCanvas()
  const editing = canvas.editingId === shape.id
  const color = shape.color || DEFAULT_INK
  const w = Math.max(Math.abs(shape.width), 1)
  const h = Math.max(Math.abs(shape.height), 1)
  // A line runs between opposite corners of its box; the sign says which two.
  const x1 = shape.width < 0 ? w : 0
  const y1 = shape.height < 0 ? h : 0
  const stroke = 2.5
  const boxy = shape.shape === 'rect' || shape.shape === 'ellipse'

  return (
    <div
      className="h-full w-full"
      onDoubleClick={(e) => {
        if (!boxy) return
        e.stopPropagation()
        canvas.startEditing(shape.id)
      }}
    >
      <NodeResizer
        isVisible={selected && !editing}
        color={PRIMARY}
        minWidth={8}
        minHeight={8}
        onResizeEnd={(_e, p) =>
          canvas.updateObject(
            shape.id,
            (o) => {
              if (o.type !== 'shape') return o
              const flipX = o.width < 0
              const flipY = o.height < 0

              return {
                ...o,
                x: flipX ? p.x + p.width : p.x,
                y: flipY ? p.y + p.height : p.y,
                width: flipX ? -p.width : p.width,
                height: flipY ? -p.height : p.height,
              }
            },
            { record: true },
          )
        }
      />
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${String(w)} ${String(h)}`}
        style={{ overflow: 'visible', display: 'block' }}
      >
        {shape.shape === 'rect' && (
          <rect
            x={stroke / 2}
            y={stroke / 2}
            width={Math.max(w - stroke, 1)}
            height={Math.max(h - stroke, 1)}
            rx={8}
            fill={`color-mix(in srgb, ${color} 10%, transparent)`}
            stroke={color}
            strokeWidth={stroke}
          />
        )}
        {shape.shape === 'ellipse' && (
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={Math.max(w / 2 - stroke / 2, 1)}
            ry={Math.max(h / 2 - stroke / 2, 1)}
            fill={`color-mix(in srgb, ${color} 10%, transparent)`}
            stroke={color}
            strokeWidth={stroke}
          />
        )}
        {(shape.shape === 'line' || shape.shape === 'arrow') && (
          <>
            <line
              x1={x1}
              y1={y1}
              x2={w - x1}
              y2={h - y1}
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              markerEnd={shape.shape === 'arrow' ? `url(#arrow-${shape.id})` : undefined}
            />
            {shape.shape === 'arrow' && (
              <defs>
                <marker
                  id={`arrow-${shape.id}`}
                  viewBox="0 0 10 10"
                  refX={8}
                  refY={5}
                  markerWidth={6}
                  markerHeight={6}
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
                </marker>
              </defs>
            )}
            {/* A fatter invisible line so a thin stroke is still easy to grab. */}
            <line x1={x1} y1={y1} x2={w - x1} y2={h - y1} stroke="transparent" strokeWidth={14} />
          </>
        )}
        {selected && !boxy && (
          <line
            x1={x1}
            y1={y1}
            x2={w - x1}
            y2={h - y1}
            stroke={PRIMARY}
            strokeOpacity={0.35}
            strokeWidth={stroke + 6}
            strokeLinecap="round"
          />
        )}
      </svg>
      {boxy && (
        <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-[14px]">
          {editing ? (
            <TextEditor
              value={shape.text ?? ''}
              className="text-center"
              style={{ color: 'rgb(var(--color-text-base))' }}
              onCommit={(next) => {
                canvas.startEditing(null)
                if (next !== (shape.text ?? '')) {
                  canvas.updateObject(shape.id, (o) => ({ ...o, text: next }), { record: true })
                }
              }}
              onCancel={() => canvas.startEditing(null)}
            />
          ) : (
            <span className="whitespace-pre-wrap break-words text-main">{shape.text}</span>
          )}
        </div>
      )}
    </div>
  )
}
