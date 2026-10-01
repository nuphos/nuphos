import { Loader2, Pencil } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../../../api'
import { announceChatTitle } from '../../../lib/chatTitleEvents'
import { Modal } from '../../Modal'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

export function ConversationTitleInput({
  sessionId,
  teamId,
  title,
  onDone,
  inline = false,
}: {
  sessionId: string
  teamId: string
  title: string
  onDone: () => void
  inline?: boolean
}) {
  const [draft, setDraft] = useState(title)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const cancelled = useRef(false)

  async function save() {
    const next = draft.trim()

    if (cancelled.current || inFlight.current) return
    if (!next) {
      if (inline) onDone()

      return
    }
    if (next === title) {
      onDone()

      return
    }
    inFlight.current = true
    setSaving(true)
    try {
      const result = await api.agentRenameConversation(sessionId, next, teamId)

      announceChatTitle({ sessionId, teamId, title: result.title })
      onDone()
    } catch (error) {
      toast.apiError('Could not rename chat', error)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <form
      className={inline ? 'titlebar-no-drag flex min-w-0 max-w-full' : 'titlebar-no-drag'}
      style={
        inline
          ? {
              width: `clamp(10rem, ${String(Array.from(draft).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 2 : 1), 2))}ch, 20rem)`,
            }
          : undefined
      }
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <label className={inline ? 'flex min-w-0 flex-1' : 'block px-5 pt-0.5 pb-3'}>
        <input
          aria-label="Chat title"
          autoFocus
          maxLength={120}
          value={draft}
          disabled={!inline && saving}
          readOnly={inline && saving}
          onBlur={
            inline
              ? () => {
                  void save()
                }
              : undefined
          }
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' && event.nativeEvent.isComposing) {
              event.preventDefault()

              return
            }
            if (event.key === 'Escape' && !saving) {
              event.preventDefault()
              cancelled.current = true
              onDone()
            }
          }}
          className={`min-w-0 w-full rounded-md border border-main bg-main text-[13px] text-main outline-none focus:border-zViolet-accent ${inline ? 'px-2 py-1' : 'px-3 py-2'}`}
        />
      </label>
      {!inline && (
        <div className="flex justify-end gap-3 px-5 pb-5">
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="h-9 min-w-[72px] !rounded-lg"
            disabled={saving}
            onClick={onDone}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="neutral"
            size="md"
            className="h-9 min-w-[72px] !rounded-lg"
            disabled={saving || !draft.trim()}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </form>
  )
}

export function EditableConversationTitle({
  sessionId,
  teamId,
  title,
  canRename,
}: {
  sessionId: string | null
  teamId: string
  title: string
  canRename: boolean
}) {
  const [editing, setEditing] = useState(false)

  if (!sessionId || !canRename) return <span className="truncate">{title}</span>
  if (editing)
    return (
      <ConversationTitleInput
        inline
        sessionId={sessionId}
        teamId={teamId}
        title={title}
        onDone={() => setEditing(false)}
      />
    )

  return (
    <button
      type="button"
      title="Rename chat"
      aria-label={`Rename chat: ${title}`}
      onClick={() => setEditing(true)}
      className="titlebar-no-drag group flex min-w-0 items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-zGray-800/60"
    >
      <span className="truncate">{title}</span>
      <Pencil className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  )
}

export function RenameConversationDialog({
  sessionId,
  teamId,
  title,
  onClose,
}: {
  sessionId: string
  teamId: string
  title: string
  onClose: () => void
}) {
  return (
    <Modal
      open
      title="Rename chat"
      description="Keep it short and recognizable"
      appearance="prompt"
      width={420}
      onClose={onClose}
    >
      <ConversationTitleInput
        sessionId={sessionId}
        teamId={teamId}
        title={title}
        onDone={onClose}
      />
    </Modal>
  )
}
