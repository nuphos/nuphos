import { Loader2, Plus } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { receiveAgentAvatars } from '../../lib/agentAvatarChoices'
import { botAvatarName, derivedBotAvatar } from '../../lib/botAvatars'
import { AgentAvatarGrid } from '../agent/AgentAvatarGrid'
import { BotAvatarImage } from '../agent/BotAvatarImage'
import { useNewConversationRuntime } from '../agent/panel/useNewConversationRuntime'
import { createBotChannel } from '../channels/botChannel'
import { BotImportDialog } from '../channels/BotImportDialog'
import { Modal } from '../Modal'
import { Button } from '../ui/button'
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
  const [importOpen, setImportOpen] = useState(false)
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
}: {
  teamId: string
  onCreated: (sessionId: string) => void
}) {
  // The face a new Bot would get anyway, until another is picked.
  const [avatar, setAvatar] = useState(() => derivedBotAvatar(crypto.randomUUID()))
  const [preview, setPreview] = useState<BotAvatarFile | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  // The Bot runs where a new chat would, so it is ready the moment it opens.
  const runtime = useNewConversationRuntime(teamId).newConversationRuntime
  const shown = preview ?? avatar

  async function create() {
    const title = name.trim()

    if (!title || busy) return
    setBusy(true)
    try {
      const startedAt = Date.now()
      const bot = await api.agentCreateBot(teamId, {
        title,
        avatar: botAvatarName(avatar),
        ...(runtime
          ? { runtimeId: runtime.id, agentRuntime: runtime.provider, runtimeLabel: runtime.label }
          : {}),
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
        <Button type="submit" variant="neutral" size="sm" disabled={busy || !name.trim()}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t('Create')}
        </Button>
      </div>
      <AgentAvatarGrid value={avatar} onChange={setAvatar} onPreview={setPreview} />
    </form>
  )
}
