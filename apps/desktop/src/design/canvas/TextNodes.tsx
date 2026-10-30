import { NodeResizer } from '@xyflow/react'
import clsx from 'clsx'

import { useDesignCanvas } from './context'
import { DEFAULT_NOTE, PRIMARY } from './helpers'
import { TextEditor } from './nodeParts'

import type { DesignNodeData } from './nodeParts'
import type { DesignNote, DesignText } from '../schema'
import type { NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'

// --- Text and notes -----------------------------------------------------------

export function TextNode({ data, selected }: NodeProps) {
  const { object: text } = data as DesignNodeData<DesignText>
  const canvas = useDesignCanvas()
  const editing = canvas.editingId === text.id
  const style: CSSProperties = {
    fontSize: text.fontSize ?? 18,
    lineHeight: 1.4,
    color: text.color || 'rgb(var(--color-text-base))',
    fontFamily: 'inherit',
  }

  return (
    <div
      className={clsx('h-full w-full', selected && !editing && 'ring-1 ring-zViolet-500')}
      onDoubleClick={(e) => {
        e.stopPropagation()
        canvas.startEditing(text.id)
      }}
    >
      <NodeResizer
        isVisible={selected && !editing}
        color={PRIMARY}
        minWidth={40}
        minHeight={20}
        onResizeEnd={(_e, p) =>
          canvas.updateObject(text.id, (o) => ({ ...o, x: p.x, y: p.y, width: p.width }), {
            record: true,
          })
        }
      />
      {editing ? (
        <TextEditor
          value={text.text}
          style={style}
          onCommit={(next) => {
            canvas.startEditing(null)
            if (next !== text.text) {
              canvas.updateObject(text.id, (o) => ({ ...o, text: next }), { record: true })
            }
          }}
          onCancel={() => canvas.startEditing(null)}
        />
      ) : (
        <div className="whitespace-pre-wrap break-words" style={style}>
          {text.text || <span className="text-tertiary">Text</span>}
        </div>
      )}
    </div>
  )
}

export function NoteNode({ data, selected }: NodeProps) {
  const { object: note } = data as DesignNodeData<DesignNote>
  const canvas = useDesignCanvas()
  const editing = canvas.editingId === note.id
  const style: CSSProperties = { fontSize: 15, lineHeight: 1.45, color: '#1f1b24' }

  return (
    <div
      className={clsx(
        'h-full w-full rounded-sm p-3 shadow-[2px_3px_8px_rgba(0,0,0,0.18)]',
        selected && 'ring-2 ring-zViolet-500',
      )}
      style={{ background: note.color || DEFAULT_NOTE }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        canvas.startEditing(note.id)
      }}
    >
      <NodeResizer
        isVisible={selected && !editing}
        color={PRIMARY}
        minWidth={80}
        minHeight={80}
        onResizeEnd={(_e, p) =>
          canvas.updateObject(
            note.id,
            (o) => ({ ...o, x: p.x, y: p.y, width: p.width, height: p.height }),
            { record: true },
          )
        }
      />
      {editing ? (
        <TextEditor
          value={note.text}
          style={style}
          onCommit={(next) => {
            canvas.startEditing(null)
            if (next !== note.text) {
              canvas.updateObject(note.id, (o) => ({ ...o, text: next }), { record: true })
            }
          }}
          onCancel={() => canvas.startEditing(null)}
        />
      ) : (
        <div
          className="h-full w-full overflow-hidden whitespace-pre-wrap break-words"
          style={style}
        >
          {note.text || <span style={{ opacity: 0.5 }}>Note</span>}
        </div>
      )}
    </div>
  )
}
