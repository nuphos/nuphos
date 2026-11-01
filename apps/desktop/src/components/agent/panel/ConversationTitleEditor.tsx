import { Loader2, Pencil } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { agentAvatarPick, pickAgentAvatar } from '../../../lib/agentAvatarChoices'
import {
  botAvatarFile,
  botAvatarLabel,
  botAvatarName,
  derivedBotAvatar,
} from '../../../lib/botAvatars'
import { announceChatTitle } from '../../../lib/chatTitleEvents'
import { sessionShortcutCombo } from '../../../lib/sessionShortcuts'
import { Modal } from '../../Modal'
import { Button } from '../../ui/button'
import { ShortcutLabel } from '../../ui/shortcut-hint'
import { toast } from '../../ui/toast'
import { Tooltip } from '../../ui/tooltip'
import { AgentAvatarGrid } from '../AgentAvatarGrid'
import { BotAvatarImage } from '../BotAvatarImage'

import type { BotAvatarFile } from '../../../lib/botAvatars'

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
          <ShortcutLabel label={t('Rename agent')} combo={sessionShortcutCombo('rename-chat')} />
        }
      >
        <button
          type="button"
          aria-label={t('Rename agent: {title}', { title })}
          onClick={() => setEditing(true)}
          className="titlebar-no-drag group flex min-w-0 items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-zGray-800/60"
        >
          <span className="truncate">{title}</span>
          <Pencil className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      </Tooltip>
    </>
  )
}

/** Renames the Agent and picks its avatar; both are shared with everyone who sees it. */
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
  // What this Agent shows now; a save compares against it.
  // What the server holds now. Each part moves forward once it saves, so a
  // retry after a partial failure only sends the part that failed.
  const [openedPick] = useState(() => agentAvatarPick(sessionId) ?? null)
  const savedTitle = useRef(title)
  const savedPick = useRef(openedPick)
  const inFlight = useRef(false)
  const [avatar, setAvatar] = useState(() => botAvatarFile(sessionId, openedPick))
  const [preview, setPreview] = useState<BotAvatarFile | null>(null)
  const [draft, setDraft] = useState(title)
  const [saving, setSaving] = useState(false)
  const shown = preview ?? avatar

  async function save() {
    const name = draft.trim()

    if (!name || inFlight.current) return
    // Picking the character the ID already selects clears the pick.
    const pick = avatar === derivedBotAvatar(sessionId) ? null : botAvatarName(avatar)

    inFlight.current = true
    setSaving(true)
    const [renamed, picked] = await Promise.allSettled([
      name !== savedTitle.current &&
        api.agentRenameConversation(sessionId, name, teamId).then((result) => {
          savedTitle.current = result.title
          announceChatTitle({ sessionId, teamId, title: result.title })
        }),
      pick !== savedPick.current &&
        pickAgentAvatar(sessionId, pick, () =>
          api.agentSetConversationAvatar(sessionId, pick, teamId),
        ).then(() => {
          savedPick.current = pick
        }),
    ])

    inFlight.current = false
    setSaving(false)
    if (renamed.status === 'rejected') toast.apiError(t('Could not rename agent'), renamed.reason)
    if (picked.status === 'rejected') toast.apiError(t('Could not change avatar'), picked.reason)
    if (renamed.status === 'fulfilled' && picked.status === 'fulfilled') onClose()
  }

  return (
    <Modal
      open
      title={t('Rename agent')}
      description={t('Your team sees the same name and avatar.')}
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
          <BotAvatarImage file={shown} className="size-16 object-contain" />
          <span aria-live="polite" className="mt-1 h-4 text-[12px] leading-4 text-tertiary">
            {botAvatarLabel(shown)}
          </span>
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
            className="mt-3 w-full rounded-md border border-main bg-main px-3 py-2 text-[13px] text-main outline-none focus:border-zViolet-accent"
          />
          <div className="mt-4 w-full">
            <AgentAvatarGrid value={avatar} onChange={setAvatar} onPreview={setPreview} />
          </div>
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
