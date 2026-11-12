import clsx from 'clsx'
import { Check, Loader2, Mic, X } from 'lucide-react'

import { t } from '../../../i18n'
import { comboParts, isMac } from '../../../lib/platform'

import { formatElapsed } from './voiceDictation'

import type { VoicePhase } from './useVoiceDictation'
import type { MouseEvent } from 'react'

const SHORTCUT = comboParts('mod+shift+u', isMac).join(isMac ? '' : '+')

// The editor keeps focus and its caret, so the transcript lands where the person was typing.
const keepCaret = (event: MouseEvent) => event.preventDefault()

/** The composer's microphone: start a take, then cancel it or stop to insert the transcript. */
export function ComposerVoiceButton({
  phase,
  elapsedMs,
  hero,
  onStart,
  onStop,
  onCancel,
}: {
  phase: VoicePhase
  elapsedMs: number
  hero: boolean
  onStart: () => void
  onStop: () => void
  onCancel: () => void
}) {
  const size = hero ? 'w-8 h-8 rounded-full' : 'w-7 h-7 rounded-md'

  if (phase.kind === 'recording') {
    return (
      <div className="flex items-center gap-1" role="group" aria-label={t('Recording voice input')}>
        <span className="flex items-center gap-1.5 px-1.5 text-[12px] tabular-nums text-secondary">
          <span className="h-2 w-2 rounded-full bg-status-danger animate-pulse" aria-hidden />
          {formatElapsed(elapsedMs)}
        </span>
        <button
          type="button"
          onMouseDown={keepCaret}
          onClick={onCancel}
          className={clsx(
            size,
            'flex items-center justify-center text-secondary hover:bg-state-hover hover:text-main transition-colors',
          )}
          title={t('Discard recording')}
          aria-label={t('Discard recording')}
        >
          <X className="w-4 h-4" />
        </button>
        <button
          type="button"
          onMouseDown={keepCaret}
          onClick={onStop}
          className={clsx(
            size,
            'flex items-center justify-center bg-surface-sunken text-main hover:bg-state-hover transition-colors',
          )}
          title={`${t('Stop and insert text')} (${SHORTCUT})`}
          aria-label={t('Stop and insert text')}
        >
          <Check className="w-4 h-4" />
        </button>
      </div>
    )
  }

  if (phase.kind === 'transcribing') {
    return (
      <span
        className={clsx(size, 'flex items-center justify-center text-tertiary')}
        title={t('Transcribing…')}
        role="status"
        aria-label={t('Transcribing…')}
      >
        <Loader2 className="w-4 h-4 animate-spin" />
      </span>
    )
  }

  return (
    <button
      type="button"
      onMouseDown={keepCaret}
      onClick={onStart}
      className={clsx(
        size,
        'flex items-center justify-center text-secondary hover:bg-state-hover hover:text-main transition-colors',
      )}
      title={`${t('Voice input')} (${SHORTCUT})`}
      aria-label={t('Voice input')}
    >
      <Mic className="w-4 h-4" />
    </button>
  )
}
