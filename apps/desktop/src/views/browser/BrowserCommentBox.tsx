import { useLayoutEffect, useRef, useState } from 'react'

import type { PickedElement } from '../../lib/browserAnnotate'

const GAP = 8

/** Comment input drawn by the host over the page, next to the picked element. */
export function BrowserCommentBox({
  rect,
  onSave,
  onCancel,
}: {
  rect: PickedElement['rect']
  onSave: (note: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLFormElement>(null)
  const [note, setNote] = useState('')
  const [position, setPosition] = useState({ left: rect.x, top: rect.y + rect.height + GAP })

  useLayoutEffect(() => {
    const box = ref.current
    const area = box?.parentElement

    if (!box || !area) return
    const maxLeft = area.clientWidth - box.offsetWidth - GAP
    const maxTop = area.clientHeight - box.offsetHeight - GAP
    const below = rect.y + rect.height + GAP
    const above = rect.y - box.offsetHeight - GAP

    setPosition({
      left: Math.max(GAP, Math.min(rect.x, maxLeft)),
      top: below <= maxTop ? below : Math.max(GAP, Math.min(above, maxTop)),
    })
  }, [rect])

  const submit = () => {
    if (note.trim()) onSave(note)
  }

  return (
    <form
      ref={ref}
      className="absolute z-10 w-72 rounded-lg border border-zGray-700 bg-zGray-900 p-2 shadow-lg"
      style={position}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <textarea
        autoFocus
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
        placeholder="What should change here?"
        aria-label="Comment"
        className="w-full resize-none bg-transparent text-xs text-main outline-none placeholder:text-tertiary"
      />
      <div className="mt-1 flex justify-end gap-1">
        <button
          type="button"
          onClick={onCancel}
          className="h-6 rounded px-2 text-xs text-secondary hover:bg-zGray-800 hover:text-main"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!note.trim()}
          className="h-6 rounded bg-zGray-100 px-2 text-xs font-medium text-zGray-900 disabled:opacity-40"
        >
          Comment
        </button>
      </div>
    </form>
  )
}
