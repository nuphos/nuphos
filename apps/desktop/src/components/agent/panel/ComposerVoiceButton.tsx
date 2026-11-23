import clsx from 'clsx'
import { Mic } from 'lucide-react'

import { t } from '../../../i18n'
import { comboParts, isMac } from '../../../lib/platform'

import type { MouseEvent } from 'react'

const SHORTCUT = comboParts('mod+shift+u', isMac).join(isMac ? '' : '+')

// The editor keeps focus and its caret, so the transcript lands where the person was typing.
const keepCaret = (event: MouseEvent) => event.preventDefault()

/** The microphone that starts a voice take; the take itself is the recording bar. */
export function ComposerVoiceButton({ hero, onStart }: { hero: boolean; onStart: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={keepCaret}
      onClick={onStart}
      className={clsx(
        hero ? 'w-8 h-8 rounded-md' : 'w-7 h-7 rounded-md',
        'flex items-center justify-center text-secondary hover:bg-state-hover hover:text-main transition-colors',
      )}
      title={`${t('Voice input')} (${SHORTCUT})`}
      aria-label={t('Voice input')}
    >
      <Mic className="w-4 h-4" />
    </button>
  )
}
