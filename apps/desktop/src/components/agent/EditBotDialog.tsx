import { clsx } from 'clsx'
import { Loader2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import {
  agentAvatarBackground,
  pickAgentAvatar,
  useAgentAvatarPick,
} from '../../lib/agentAvatarChoices'
import { trustedAvatarURL } from '../../lib/avatarUrl'
import { botAvatarBackground } from '../../lib/botAvatarBackgrounds'
import { botAvatarFile, botAvatarName } from '../../lib/botAvatars'
import { announceChatTitle } from '../../lib/chatTitleEvents'
import { queryClient } from '../../lib/query/client'
import { saveBotIdentity } from '../../lib/saveBotIdentity'
import { SubHeader } from '../../views/settings/shared'
import { listedConversation } from '../channels/channelShared'
import { Modal } from '../Modal'
import { setChatInstructions } from '../sidebar/agentSessions'
import { Button } from '../ui/button'
import { toast } from '../ui/toast'

import { AdvancedPage, GeneralPage } from './EditBotPages'

const PAGES = [
  { id: 'general', label: () => t('General') },
  { id: 'advanced', label: () => t('Advanced') },
] as const

type Page = (typeof PAGES)[number]['id']

/** The two pages, as the Home gallery's tabs; up and down move between them. */
function PageNav({
  formId,
  page,
  onPage,
}: {
  formId: string
  page: Page
  onPage: (page: Page) => void
}) {
  return (
    <div
      role="tablist"
      aria-orientation="vertical"
      aria-label={t('Edit Bot')}
      className="flex w-[176px] shrink-0 flex-col gap-0.5 border-r border-line-control p-3"
    >
      {PAGES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`${formId}-${id}`}
          aria-selected={page === id}
          aria-controls={formId}
          tabIndex={page === id ? 0 : -1}
          onClick={() => onPage(id)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault()
            const next = id === 'general' ? 'advanced' : 'general'

            onPage(next)
            document.getElementById(`${formId}-${next}`)?.focus()
          }}
          className={clsx(
            'flex h-8 items-center gap-2 rounded-md px-2.5 text-left text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-line-focus',
            page === id
              ? 'bg-surface-sunken text-main'
              : 'text-secondary hover:bg-state-hover hover:text-main',
          )}
        >
          {label()}
        </button>
      ))}
    </div>
  )
}

/** A Bot's owner edits its name, face and instructions with one Save; Triggers switch at once. */
export function EditBotDialog({
  sessionId,
  teamId,
  title,
  onClose,
  onEditTrigger,
}: {
  sessionId: string
  teamId: string
  title: string
  onClose: () => void
  /** Starts this message in the Bot's chat; without one, Trigger rows offer no Edit. */
  onEditTrigger?: (message: string) => void
}) {
  const formId = useId()
  const currentAvatar = useAgentAvatarPick(sessionId)
  const photo = trustedAvatarURL(currentAvatar)
  const [page, setPage] = useState<Page>('general')
  const [avatar, setAvatar] = useState(() =>
    photo ? undefined : botAvatarFile(sessionId, currentAvatar),
  )
  const [savedBackground] = useState(() => botAvatarBackground(agentAvatarBackground(sessionId)))
  const [background, setBackground] = useState(savedBackground)
  const [draft, setDraft] = useState(title)
  const [savedInstructions] = useState(
    () => listedConversation(teamId, sessionId)?.instructions ?? '',
  )
  const [instructions, setInstructions] = useState(savedInstructions)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)

  async function save() {
    const name = draft.trim()

    if (!name || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    try {
      await saveBotIdentity(
        title,
        name,
        { avatar: currentAvatar, background: savedBackground },
        { avatar: avatar ? botAvatarName(avatar) : undefined, background },
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
      if (instructions !== savedInstructions) {
        const saved = await api.agentSetBotInstructions(sessionId, instructions, teamId)

        await setChatInstructions(queryClient, teamId, sessionId, saved.instructions)
      }
      onClose()
    } catch (error) {
      toast.apiError(t('Could not save Bot'), error)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title={t('Edit Bot')}
      description={t('Only you can edit this Bot. Saving updates its next turn.')}
      width={720}
      headerDivider
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-3">
          <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button type="submit" form={formId} size="sm" disabled={saving || !draft.trim()}>
            {saving && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
            {t('Save')}
          </Button>
        </div>
      }
    >
      <div className="flex h-[560px]">
        <PageNav formId={formId} page={page} onPage={setPage} />
        <form
          id={formId}
          role="tabpanel"
          aria-labelledby={`${formId}-${page}`}
          className="min-w-0 flex-1 overflow-auto p-6"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {/* One fieldset keeps every unsaved edit while saving; the pages share this state. */}
          <fieldset disabled={saving} className="m-0 min-w-0 space-y-5 border-0 p-0">
            <SubHeader title={PAGES.find(({ id }) => id === page)?.label() ?? ''} />
            {page === 'general' ? (
              <GeneralPage
                name={draft}
                onNameChange={setDraft}
                avatar={avatar}
                onAvatarChange={setAvatar}
                background={background}
                onBackgroundChange={setBackground}
                photo={photo}
              />
            ) : (
              <AdvancedPage
                teamId={teamId}
                sessionId={sessionId}
                name={title}
                instructions={instructions}
                onInstructionsChange={setInstructions}
                onEditTrigger={
                  onEditTrigger &&
                  ((message) => {
                    onClose()
                    onEditTrigger(message)
                  })
                }
              />
            )}
          </fieldset>
        </form>
      </div>
    </Modal>
  )
}
