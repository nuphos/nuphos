import { Square } from 'lucide-react'

import { t } from '../../../i18n'

/** Closes a turn the user stopped, in the muted style of the fold header. */
export function StoppedTurnEnding({ calls }: { calls: number }) {
  return (
    <div className="flex items-center gap-1.5 text-[12.5px] text-tertiary">
      <Square className="h-2.5 w-2.5" strokeWidth={2} fill="currentColor" aria-hidden="true" />
      {t('Stopped by you')}
      {calls > 0 && (
        <span className="text-tertiary/70">
          · {calls === 1 ? t('1 call') : t('{n} calls', { n: String(calls) })}
        </span>
      )}
    </div>
  )
}
