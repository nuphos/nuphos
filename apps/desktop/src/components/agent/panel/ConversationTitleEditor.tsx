import { Loader2, Pencil } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import {
  agentAvatarBackground,
  pickAgentAvatar,
  useAgentAvatarPick,
} from '../../../lib/agentAvatarChoices'
import { trustedAvatarURL } from '../../../lib/avatarUrl'
import { botAvatarBackground } from '../../../lib/botAvatarBackgrounds'
import { botAvatarFile, botAvatarName } from '../../../lib/botAvatars'
import { announceChatTitle } from '../../../lib/chatTitleEvents'
import { saveBotIdentity } from '../../../lib/saveBotIdentity'
import { sessionShortcutCombo } from '../../../lib/sessionShortcuts'
import { listedConversation } from '../../channels/channelShared'
import { Modal } from '../../Modal'
import { Button } from '../../ui/button'
import { ShortcutLabel } from '../../ui/shortcut-hint'
import { toast } from '../../ui/toast'
import { Tooltip } from '../../ui/tooltip'
import { BotIdentityFields } from '../BotIdentityFields'

const LABELS = {
  task: {
    rename: () => t('Rename task'),
    named: (title: string) => t('Rename task: {title}', { title }),
    failed: () => t('Could not rename task'),
  },
  bot: {
    rename: () => t('Edit Bot'),
    named: (title: string) => t('Edit Bot: {title}', { title }),
    failed: () => t('Could not rename Bot'),
  },
  chat: {
    rename: () => t('Rename chat'),
    named: (title: string) => t('Rename chat: {title}', { title }),
    failed: () => t('Could not rename chat'),
  },
}

/** What renaming this conversation renames: a Bot, a group chat, or a Task. */
function useRenamed(teamId: string, sessionId: string): keyof typeof LABELS {
  const bot = Boolean(useAgentAvatarPick(sessionId))

  if (bot) return 'bot'

  return listedConversation(teamId, sessionId)?.kind === 'channel' ? 'chat' : 'task'
}

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
  const renamed = useRenamed(teamId, sessionId ?? '')

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
          // A group chat has no rename shortcut: that is a Task's titlebar menu.
          renamed === 'chat' ? (
            LABELS.chat.rename()
          ) : (
            <ShortcutLabel
              label={LABELS[renamed].rename()}
              combo={sessionShortcutCombo('rename-chat')}
            />
          )
        }
      >
        <button
          type="button"
          aria-label={LABELS[renamed].named(title)}
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
  const currentAvatar = useAgentAvatarPick(sessionId)
  const renamed = useRenamed(teamId, sessionId)
  const bot = renamed === 'bot'
  const photo = trustedAvatarURL(currentAvatar)
  const [avatar, setAvatar] = useState(() =>
    photo ? undefined : botAvatarFile(sessionId, currentAvatar),
  )
  const [savedBackground] = useState(() => botAvatarBackground(agentAvatarBackground(sessionId)))
  const [background, setBackground] = useState(savedBackground)
  const [draft, setDraft] = useState(title)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  async function save() {
    const name = draft.trim()

    if (!name || inFlight.current) return
    if (!bot && name === title) {
      onClose()

      return
    }
    inFlight.current = true
    setSaving(true)
    try {
      await saveBotIdentity(
        title,
        name,
        { avatar: currentAvatar, background: savedBackground },
        { avatar: bot && avatar ? botAvatarName(avatar) : undefined, background },
        {
          rename: async (nextName) => {
            const result = await api.agentRenameConversation(sessionId, nextName, teamId)

            announceChatTitle({ sessionId, teamId, title: result.title })
          },
          setAvatar: async (nextAvatar, nextBackground) => {
            await pickAgentAvatar(
              sessionId,
              nextAvatar,
              () => api.agentSetConversationAvatar(sessionId, nextAvatar, teamId, nextBackground),
              nextBackground,
            )
          },
        },
      )
      onClose()
    } catch (error) {
      toast.apiError(LABELS[renamed].failed(), error)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={LABELS[renamed].rename()}
      appearance="prompt"
      width={bot ? 440 : 420}
      onClose={onClose}
    >
      <form
        className="titlebar-no-drag"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {bot ? (
          <div className="flex flex-col gap-3 px-5 pt-1 pb-5">
            <BotIdentityFields
              name={draft}
              onNameChange={setDraft}
              avatar={avatar}
              onAvatarChange={setAvatar}
              background={background}
              onBackgroundChange={setBackground}
              photo={photo}
              busy={saving}
              submitLabel={t('Save')}
            />
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center px-5 pt-1 pb-5">
              <input
                aria-label={renamed === 'chat' ? t('Name') : t('Task name')}
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
          </>
        )}
      </form>
    </Modal>
  )
}
