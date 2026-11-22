import { Bot, Plus, Users } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../../api'
import { locale, t } from '../../i18n'
import { receiveAgentAvatars } from '../../lib/agentAvatarChoices'
import { usable } from '../../lib/agentName'
import { botAvatarName, derivedBotAvatar } from '../../lib/botAvatars'
import { LocalAgentSetupCards } from '../../views/onboarding/setup/LocalAgentsStep'
import { BotIdentityFields } from '../agent/BotIdentityFields'
import { useNewConversationRuntime } from '../agent/panel/useNewConversationRuntime'
import { createBotChannel } from '../channels/botChannel'
import { BotImportDialog } from '../channels/BotImportDialog'
import { Modal } from '../Modal'
import { Button } from '../ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui/menu'
import { Checkbox } from '../ui/checkbox'
import { toast } from '../ui/toast'

import { BotStartIntro } from './BotStartIntro'
import { NewGroupChatDialog } from './NewGroupChatDialog'

import type { BotAvatarBackground } from '../../lib/botAvatarBackgrounds'

/** "+" on Bots: a new Bot, with the face and name picked here, or a new group chat with its members. */
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
  const [groupOpen, setGroupOpen] = useState(false)
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
            <MenuItem icon={<Users className="size-3.5" />} onClick={() => setGroupOpen(true)}>
              {t('New Group Chat')}
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
      {open && (
        <Modal
          open
          title={connecting ? t('Connect a runtime') : t('New Bot')}
          appearance="prompt"
          width={connecting ? 600 : 440}
          onClose={() => (connecting ? setConnecting(false) : setOpen(false))}
        >
          <div className="titlebar-no-drag px-5 pt-1 pb-5">
            {connecting && (
              <div className="space-y-4 pt-3">
                <LocalAgentSetupCards
                  teamId={teamId}
                  onCloud={() => {
                    setConnecting(false)
                    setOpen(false)
                  }}
                />
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
      {groupOpen && (
        <NewGroupChatDialog
          teamId={teamId}
          onClose={() => setGroupOpen(false)}
          onCreated={(sessionId) => {
            setGroupOpen(false)
            onCreated(sessionId)
          }}
        />
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
  const [background, setBackground] = useState<BotAvatarBackground>('none')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [coordinate, setCoordinate] = useState(false)
  const [createdBot, setCreatedBot] = useState<{
    sessionId: string
    title: string
    avatar: string
  } | null>(null)
  const channel = useRef<string | null>(null)
  const creating = useRef(false)
  // The Bot runs where a new chat would, so it is ready the moment it opens.
  const {
    newConversationRuntime: runtime,
    runtimeInstancesLoading: loading,
    runtimeInstancesError: runtimeError,
  } = useNewConversationRuntime(teamId)

  async function create() {
    const title = name.trim()

    if (!title || creating.current || loading) return
    if (runtimeError) {
      toast.apiError(t('Could not load runtimes'), runtimeError)

      return
    }
    if (!runtime || !usable(runtime) || runtime.deletion) {
      onNeedRuntime()

      return
    }
    creating.current = true
    setBusy(true)
    try {
      const startedAt = Date.now()
      const bot =
        createdBot ??
        (await api.agentCreateBot(teamId, {
          onboarding: true,
          locale,
          ...(coordinate ? { starter: 'coordinate' as const } : {}),
          title,
          avatar: botAvatarName(avatar),
          ...(background === 'none' ? {} : { background }),
          ...(runtime
            ? { runtimeId: runtime.id, agentRuntime: runtime.provider, runtimeLabel: runtime.label }
            : {}),
        }))

      setCreatedBot(bot)
      receiveAgentAvatars([bot], startedAt)
      // A Bot is talked to in its own chat: a channel with the Bot in it.
      channel.current ??= await createBotChannel(teamId, bot.sessionId)
      await api.agentStartBotOnboarding(bot.sessionId, teamId, channel.current)
      onCreated(channel.current)
    } catch (error) {
      toast.apiError(t('Could not finish setting up the Bot. Retry to continue.'), error)
      setBusy(false)
    } finally {
      creating.current = false
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
      <BotIdentityFields
        name={name}
        onNameChange={setName}
        avatar={avatar}
        onAvatarChange={setAvatar}
        background={background}
        onBackgroundChange={setBackground}
        busy={busy}
        identityLocked={!!createdBot}
        disabled={loading}
        submitLabel={createdBot ? t('Retry setup') : t('Create')}
      >
        <div className="space-y-1.5">
          <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] text-secondary">
            <Checkbox
              checked={coordinate}
              onCheckedChange={(checked) => setCoordinate(checked)}
              disabled={busy || !!createdBot}
              aria-describedby="bot-coordination-description"
            />
            {t('Help me coordinate work')}
          </label>
          <p
            id="bot-coordination-description"
            className="pl-6 text-[12px] leading-relaxed text-tertiary"
          >
            {t('Break down work, delegate tasks, and follow up on results.')}
          </p>
        </div>
      </BotIdentityFields>
    </form>
  )
}
