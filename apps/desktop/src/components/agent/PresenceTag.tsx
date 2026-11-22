import { t } from '../../i18n'

import type { BotPresence } from '../../api/agent-types'

/** The dot and word a member list shows for a Bot (#3308). The colours keep the runtime
 *  menu's meanings: green can reply, amber needs a person or a wait, red cannot run. */
function look(presence: BotPresence): { color: string; label: string } {
  if (presence.state === 'online') return { color: 'bg-success', label: t('Online') }
  if (presence.state === 'busy') return { color: 'bg-success', label: t('Busy') }
  if (presence.reason === 'computer_offline') return { color: 'bg-error', label: t('Offline') }
  if (presence.reason === 'sign_in_required')
    return { color: 'bg-warning', label: t('Needs sign-in') }
  if (presence.reason === 'usage_limit') return { color: 'bg-warning', label: t('Out of usage') }

  return { color: 'bg-error', label: t('Unavailable') }
}

export function PresenceTag({ presence }: { presence: BotPresence }) {
  const { color, label } = look(presence)

  return (
    <span className="flex items-center gap-1.5 px-1.5 text-[12px] text-tertiary">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />
      {label}
    </span>
  )
}
