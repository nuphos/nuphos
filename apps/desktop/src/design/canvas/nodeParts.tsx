import { Handle, Position } from '@xyflow/react'
import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'

import { t } from '../../i18n'

import { PRIMARY } from './helpers'

import type { CSSProperties, KeyboardEvent } from 'react'

export type DesignNodeData<T> = { object: T }

const HANDLE: CSSProperties = {
  width: 10,
  height: 10,
  background: PRIMARY,
  border: '2px solid rgb(var(--color-background-base))',
}

export function FrameHandles({ visible }: { visible: boolean }) {
  const style = { ...HANDLE, opacity: visible ? 1 : 0 }

  return (
    <>
      <Handle type="source" position={Position.Top} id="top" style={style} />
      <Handle type="source" position={Position.Right} id="right" style={style} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={style} />
      <Handle type="source" position={Position.Left} id="left" style={style} />
    </>
  )
}

/** A title the user can rename by double-clicking; Enter or blur saves, Escape cancels. */
export function EditableTitle({
  value,
  placeholder,
  className,
  onChange,
}: {
  value: string
  placeholder: string
  className?: string
  onChange: (next: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <span
        className={clsx('cursor-text truncate', className)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          setDraft(value)
        }}
      >
        {value || placeholder}
      </span>
    )
  }
  const finish = () => {
    const next = draft.trim()

    setDraft(null)
    if (next !== value) onChange(next || placeholder)
  }

  return (
    <input
      autoFocus
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish()
        if (e.key === 'Escape') setDraft(null)
      }}
      aria-label={t('Title')}
      className={clsx(
        'nodrag nopan h-6 rounded border border-zViolet-500 bg-main px-1.5 text-main outline-none focus:ring-1 focus:ring-zViolet-500/60',
        className,
      )}
    />
  )
}

/** A text field over a node while it is being edited; ⌘Enter or blur commits, Escape cancels. */
export function TextEditor({
  value,
  onCommit,
  onCancel,
  className,
  style,
}: {
  value: string
  onCommit: (next: string) => void
  onCancel: () => void
  className?: string
  style?: CSSProperties
}) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current

    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape') onCancel()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onCommit(draft)
  }

  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={onKeyDown}
      aria-label={t('Text')}
      className={clsx(
        'nodrag nopan nowheel h-full w-full resize-none border border-transparent bg-transparent outline-none focus:ring-1 focus:ring-zViolet-500/60',
        className,
      )}
      style={style}
    />
  )
}
