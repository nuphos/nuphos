import { useState } from 'react'

import { Button } from '../../ui/button'
import { InputGroup, InputGroupInput } from '../../ui/input-group'

/** Inline editor for a sent message. Sending forks the chat, so this one stays as it was. */
export function EditMessageForm({
  text,
  onCancel,
  onSend,
}: {
  text: string
  onCancel: () => void
  onSend: (text: string) => void
}) {
  const [draft, setDraft] = useState(text)
  const trimmed = draft.trim()

  return (
    <InputGroup
      render={<form />}
      className="flex w-full flex-col gap-2 rounded-2xl border border-main bg-zGray-800/60 p-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (trimmed) onSend(trimmed)
      }}
    >
      <InputGroupInput
        render={<textarea />}
        autoFocus
        value={draft}
        aria-label="Edit message"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            if (trimmed) onSend(trimmed)
          }
        }}
        className="max-h-[40vh] min-h-[44px] w-full resize-none px-1.5 py-1 text-[13.5px] text-main [field-sizing:content]"
      />
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto pl-1.5 text-[11.5px] text-tertiary">Sends in a new agent</span>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!trimmed}>
          Send
        </Button>
      </div>
    </InputGroup>
  )
}
