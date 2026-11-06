import { Plus } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { t } from '../../i18n'
import { receiveAgentAvatars } from '../../lib/agentAvatarChoices'
import { toast } from '../ui/toast'

/**
 * "+" on Bots: a Bot exists, with a name and a face, the moment it is asked
 * for. There is no form; it asks what it should do, and changes itself later.
 */
export function NewBotButton({
  teamId,
  onCreated,
}: {
  teamId: string
  onCreated: (sessionId: string) => void
}) {
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      const startedAt = Date.now()
      const bot = await api.agentCreateBot(teamId)

      receiveAgentAvatars([bot], startedAt)
      onCreated(bot.sessionId)
    } catch (error) {
      toast.apiError(t('Could not create the Bot'), error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t('New Bot')}
      title={t('New Bot')}
      aria-disabled={busy}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        void create()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        void create()
      }}
      className="ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-tertiary hover:bg-[var(--sidebar-overlay-hover)] hover:text-secondary"
    >
      <Plus className="h-3.5 w-3.5" strokeWidth={2} />
    </span>
  )
}
