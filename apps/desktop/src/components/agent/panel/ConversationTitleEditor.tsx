import { Loader2, Pencil } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { useAgentAvatarPick } from '../../../lib/agentAvatarChoices'
import { announceChatTitle } from '../../../lib/chatTitleEvents'
import { sessionShortcutCombo } from '../../../lib/sessionShortcuts'
import { Modal } from '../../Modal'
import { Button } from '../../ui/button'
import { ShortcutLabel } from '../../ui/shortcut-hint'
import { toast } from '../../ui/toast'
import { Tooltip } from '../../ui/tooltip'

export function EditableConversationTitle({
  sessionId,
  teamId,
  title,
  canRename,
  editing: editingProp,
  onEditingChange,
}: {
  sessionId: string | null
  teamId: string
  title: string
  canRename: boolean
  /** Lets another control (the titlebar menu) open the editor. */
  editing?: boolean
  onEditingChange?: (editing: boolean) => void
}) {
  const [localEditing, setLocalEditing] = useState(false)
  const editing = editingProp ?? localEditing
  const setEditing = onEditingChange ?? setLocalEditing
  const bot = Boolean(useAgentAvatarPick(sessionId ?? ''))

  if (!sessionId || !canRename) return <span className="truncate">{title}</span>

  return (
    <>
      {editing && (
        <RenameConversationDialog
          sessionId={sessionId}
          teamId={teamId}
          title={title}
          onClose={() => setEditing(false)}
        />
      )}
      <Tooltip
        side="bottom"
        triggerClassName="min-w-0"
        content={
          <ShortcutLabel
            label={bot ? t('Rename Bot') : t('Rename task')}
            combo={sessionShortcutCombo('rename-chat')}
          />
        }
      >
        <button
          type="button"
          aria-label={
            bot ? t('Rename Bot: {title}', { title }) : t('Rename task: {title}', { title })
          }
          onClick={() => setEditing(true)}
          className="titlebar-no-drag group flex min-w-0 items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-state-hover"
        >
          <span className="truncate">{title}</span>
          <Pencil className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      </Tooltip>
    </>
  )
}

/**
 * Renames the agent for everyone who sees it. A Bot's face and instructions are
 * not edited here: you tell the Bot, and it changes itself with `update_self`.
 */
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
  const bot = Boolean(useAgentAvatarPick(sessionId))
  const [draft, setDraft] = useState(title)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  async function save() {
    const name = draft.trim()

    if (!name || inFlight.current) return
    if (name === title) {
      onClose()

      return
    }
    inFlight.current = true
    setSaving(true)
    try {
      const result = await api.agentRenameConversation(sessionId, name, teamId)

      announceChatTitle({ sessionId, teamId, title: result.title })
      onClose()
    } catch (error) {
      toast.apiError(bot ? t('Could not rename Bot') : t('Could not rename task'), error)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={bot ? t('Rename Bot') : t('Rename task')}
      appearance="prompt"
      width={420}
      onClose={onClose}
    >
      <form
        className="titlebar-no-drag"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex flex-col items-center px-5 pt-1 pb-5">
          <input
            aria-label={t('Agent name')}
            autoFocus
            maxLength={120}
            value={draft}
            disabled={saving}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
              if (event.key === 'Escape' && !saving) {
                event.preventDefault()
                onClose()
              }
            }}
            className="w-full rounded-md border border-main bg-main px-3 py-2 text-[13px] text-main outline-none focus:border-line-focus"
          />
        </div>
        <div className="flex justify-end gap-3 px-5 pb-5">
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="h-9 min-w-[72px] !rounded-lg"
            disabled={saving}
            onClick={onClose}
          >
            {t('Cancel')}
          </Button>
          <Button
            type="submit"
            variant="neutral"
            size="md"
            className="h-9 min-w-[72px] !rounded-lg"
            disabled={saving || !draft.trim()}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? t('Saving…') : t('Save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
