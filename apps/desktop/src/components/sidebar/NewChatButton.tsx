import { Bot, Loader2, Plus, Users } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { receiveAgentAvatars } from '../../lib/agentAvatarChoices'
import { usable } from '../../lib/agentName'
import { botAvatarName, derivedBotAvatar } from '../../lib/botAvatars'
import { LocalAgentSetupCards } from '../../views/onboarding/setup/LocalAgentsStep'
import { AgentAvatarGrid } from '../agent/AgentAvatarGrid'
import { BotAvatarImage } from '../agent/BotAvatarImage'
import { useNewConversationRuntime } from '../agent/panel/useNewConversationRuntime'
import { createBotChannel } from '../channels/botChannel'
import { BotImportDialog } from '../channels/BotImportDialog'
import { markChannel } from '../channels/channelKind'
import { Modal } from '../Modal'
import { Button } from '../ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/menu'
import { toast } from '../ui/toast'

import { BotStartIntro } from './BotStartIntro'

import type { BotAvatarFile } from '../../lib/botAvatars'

/** "+" on Bots: a new Bot, with the face and name picked here, or a new group chat. */
export function NewChatButton({
  teamId,
  onCreated,
  empty = false,
  visible = true,
  firstBot = false,
}: {
  teamId: string
  empty?: boolean
  visible?: boolean
  firstBot?: boolean
  onCreated: (sessionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const created = (sessionId: string) => {
    setOpen(false)
    onCreated(sessionId)
  }

  return (
    <>
      {empty ? (
        <BotStartIntro
          firstBot={firstBot}
          visible={visible}
          onCreate={() => setOpen(true)}
          onImport={() => setImportOpen(true)}
        />
      ) : (
        <Menu>
          <MenuTrigger
            aria-label={t('New')}
            title={t('New')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-tertiary hover:bg-[var(--sidebar-overlay-hover)] hover:text-secondary"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Bot className="size-3.5" />} onClick={() => setOpen(true)}>
              {t('New Bot')}
            </MenuItem>
            <MenuItem
              icon={<Users className="size-3.5" />}
              onClick={() => {
                // An empty chat of the viewer's own: people and Bots join it from Share.
                api.agentCreateChannel(teamId, true).then(
                  ({ sessionId }) => {
                    markChannel(sessionId)
                    onCreated(sessionId)
                  },
                  (error: unknown) => toast.apiError(t('Could not create the group chat'), error),
                )
              }}
            >
              {t('New Group Chat')}
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
      {open && (
        <Modal
          open
          title={connecting ? t('Connect your agent') : t('New Bot')}
          appearance="prompt"
          width={connecting ? 600 : 440}
          onClose={() => (connecting ? setConnecting(false) : setOpen(false))}
        >
          <div className="titlebar-no-drag px-5 pt-1 pb-5">
            {connecting && (
              <div className="space-y-4 pt-3">
                <LocalAgentSetupCards />
                <div className="flex justify-end">
                  <Button variant="secondary" onClick={() => setConnecting(false)}>
                    {t('Back')}
                  </Button>
                </div>
              </div>
            )}
            <div hidden={connecting}>
              <NewBotForm
                teamId={teamId}
                onCreated={created}
                onNeedRuntime={() => setConnecting(true)}
              />
              <Button
                variant="ghost"
                className="mt-3"
                onClick={() => {
                  setOpen(false)
                  setImportOpen(true)
                }}
              >
                {t('Import from Grok Bot…')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {importOpen && (
        <BotImportDialog teamId={teamId} onClose={() => setImportOpen(false)} onOpen={onCreated} />
      )}
    </>
  )
}

/** Pick a face, type a name, and the Bot exists with exactly those. */
function NewBotForm({
  teamId,
  onCreated,
  onNeedRuntime,
}: {
  teamId: string
  onCreated: (sessionId: string) => void
  onNeedRuntime: () => void
}) {
  // The face a new Bot would get anyway, until another is picked.
  const [avatar, setAvatar] = useState(() => derivedBotAvatar(crypto.randomUUID()))
  const [preview, setPreview] = useState<BotAvatarFile | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // The Bot runs where a new chat would, so it is ready the moment it opens.
  const {
    newConversationRuntime: runtime,
    runtimeInstancesLoading: loading,
    runtimeInstancesError: runtimeError,
  } = useNewConversationRuntime(teamId)
  const shown = preview ?? avatar

  async function create() {
    const title = name.trim()

    if (!title || busy || loading) return
    if (runtimeError) {
      toast.apiError(t('Could not load agents'), runtimeError)

      return
    }
    if (!runtime || !usable(runtime) || runtime.deletion) {
      onNeedRuntime()

      return
    }
    setBusy(true)
    try {
      const startedAt = Date.now()
      const bot = await api.agentCreateBot(teamId, {
        title,
        avatar: botAvatarName(avatar),
        runtimeId: runtime.id,
        agentRuntime: runtime.provider,
        runtimeLabel: runtime.label,
      })

      receiveAgentAvatars([bot], startedAt)
      // A Bot is talked to in its own chat: a channel with the Bot in it.
      onCreated(await createBotChannel(teamId, bot.sessionId))
    } catch (error) {
      toast.apiError(t('Could not create the Bot'), error)
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
    >
      <div className="flex items-center gap-3">
        <BotAvatarImage file={shown} className="size-10 shrink-0 object-contain" />
        <input
          aria-label={t('Agent name')}
          placeholder={t('Name')}
          autoFocus
          maxLength={120}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
          }}
          className="min-w-0 flex-1 rounded-md border border-main bg-main px-3 py-2 text-[13px] text-main outline-none focus:border-line-focus"
        />
        <Button
          type="submit"
          variant="neutral"
          size="sm"
          disabled={busy || loading || !name.trim()}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('Create')}
        </Button>
      </div>
      <AgentAvatarGrid value={avatar} onChange={setAvatar} onPreview={setPreview} />
    </form>
  )
}
