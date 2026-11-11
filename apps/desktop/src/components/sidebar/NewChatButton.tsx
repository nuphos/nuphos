import { Loader2, Plus } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../../api'
import { locale, t } from '../../i18n'
import { receiveAgentAvatars } from '../../lib/agentAvatarChoices'
import { botAvatarName, derivedBotAvatar } from '../../lib/botAvatars'
import { AgentAvatarGrid } from '../agent/AgentAvatarGrid'
import { BotAvatarImage } from '../agent/BotAvatarImage'
import { useNewConversationRuntime } from '../agent/panel/useNewConversationRuntime'
import { createBotChannel } from '../channels/botChannel'
import { Modal } from '../Modal'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { toast } from '../ui/toast'

import type { BotAvatarFile } from '../../lib/botAvatars'

/** "+" on Chats: a new Bot, with the face and name picked here. */
export function NewChatButton({
  teamId,
  onCreated,
}: {
  teamId: string
  onCreated: (sessionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const created = (sessionId: string) => {
    setOpen(false)
    onCreated(sessionId)
  }

  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-label={t('New Bot')}
        title={t('New Bot')}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          setOpen(true)
        }}
        className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-tertiary hover:bg-[var(--sidebar-overlay-hover)] hover:text-secondary"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
      {open && (
        <Modal
          open
          title={t('New Bot')}
          appearance="prompt"
          width={440}
          onClose={() => setOpen(false)}
        >
          <div className="titlebar-no-drag px-5 pt-1 pb-5">
            <NewBotForm teamId={teamId} onCreated={created} />
          </div>
        </Modal>
      )}
    </>
  )
}

/** Pick a face, type a name, and the Bot exists with exactly those. */
function NewBotForm({
  teamId,
  onCreated,
}: {
  teamId: string
  onCreated: (sessionId: string) => void
}) {
  // The face a new Bot would get anyway, until another is picked.
  const [avatar, setAvatar] = useState(() => derivedBotAvatar(crypto.randomUUID()))
  const [preview, setPreview] = useState<BotAvatarFile | null>(null)
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
  const runtime = useNewConversationRuntime(teamId).newConversationRuntime
  const shown = preview ?? avatar

  async function create() {
    const title = name.trim()

    if (!title || creating.current) return
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
      <div className="flex items-center gap-3">
        <BotAvatarImage file={shown} className="size-10 shrink-0 object-contain" />
        <input
          aria-label={t('Agent name')}
          placeholder={t('Name')}
          autoFocus
          maxLength={120}
          value={name}
          disabled={busy || !!createdBot}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
          }}
          className="min-w-0 flex-1 rounded-md border border-main bg-main px-3 py-2 text-[13px] text-main outline-none focus:border-line-focus"
        />
        <Button type="submit" variant="neutral" size="sm" disabled={busy || !name.trim()}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {createdBot ? t('Retry setup') : t('Create')}
        </Button>
      </div>
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
      <fieldset
        disabled={busy || !!createdBot}
        className="m-0 min-w-0 border-0 p-0 disabled:pointer-events-none disabled:opacity-60"
      >
        <AgentAvatarGrid value={avatar} onChange={setAvatar} onPreview={setPreview} />
      </fieldset>
    </form>
  )
}
