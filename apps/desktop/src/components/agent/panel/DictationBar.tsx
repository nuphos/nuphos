import clsx from 'clsx'
import { ArrowUp, Loader2, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { t } from '../../../i18n'
import { comboParts, isMac } from '../../../lib/platform'

import { formatElapsed, isVoiceShortcut, waveformBars } from './voiceDictation'

import type { VoicePhase } from './useVoiceDictation'

const SHORTCUT = comboParts('mod+shift+u', isMac).join(isMac ? '' : '+')

/** Bars are 2px wide every 4px, 24px high, as in the iOS waveform. */
const STEP = 4
const BAR = 2
const HEIGHT = 24

const ROUND =
  'flex size-[30px] shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40'
const GREY = `${ROUND} bg-surface-sunken text-main enabled:hover:bg-state-hover`

/**
 * The live microphone level, newest at the right; the part not yet recorded is a
 * dotted baseline.
 */
function Waveform({ levels }: { levels: number[] }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const node = box.current

    if (!node) return
    const observer = new ResizeObserver(() => setWidth(node.clientWidth))

    observer.observe(node)
    setWidth(node.clientWidth)

    return () => observer.disconnect()
  }, [])

  const bars = waveformBars(levels, width / STEP)

  return (
    <div ref={box} className="h-6 min-w-0 flex-1" aria-hidden>
      <svg width={width} height={HEIGHT} className="block">
        {bars.map((level, index) => {
          const height = Math.max(BAR, (level ?? 0) * HEIGHT)

          return (
            <rect
              // Slots are positions, not items: the same slot shows a newer level each frame.
              key={index}
              x={index * STEP}
              y={(HEIGHT - height) / 2}
              width={BAR}
              height={height}
              rx={BAR / 2}
              className={clsx(
                'fill-current',
                level === null ? 'text-tertiary opacity-50' : 'text-main',
              )}
            />
          )
        })}
      </svg>
    </div>
  )
}

/**
 * A voice take in place of a text field, after the iOS composer's recording bar:
 * ✕ discards it, ■ puts the transcript into the field to be read first, and ↑
 * sends it as soon as it is in. While transcribing, a spinner takes the
 * waveform's place and ✕ still cancels. Esc discards, and the voice shortcut
 * stops, as ■ does.
 */
export function DictationBar({
  phase,
  elapsedMs,
  levels,
  onCancel,
  onStop,
  onSend,
}: {
  phase: VoicePhase
  elapsedMs: number
  levels: number[]
  onCancel: () => void
  onStop: () => void
  onSend: () => void
}) {
  const stop = useRef<HTMLButtonElement>(null)
  const discard = useRef<HTMLButtonElement>(null)
  const recording = phase.kind === 'recording'

  // The field it replaced had focus: keep the keyboard on the take, on ■ while it
  // records and on ✕ once ■ is disabled for transcribing, so Esc still reaches the bar.
  useEffect(() => {
    const target = recording ? stop : discard

    target.current?.focus()
  }, [recording])

  return (
    <div
      className="flex h-[38px] min-w-0 flex-1 items-center gap-2.5"
      role="group"
      aria-label={recording ? t('Recording voice input') : t('Transcribing…')}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        } else if (recording && isVoiceShortcut(event.nativeEvent, isMac)) {
          event.preventDefault()
          onStop()
        }
      }}
    >
      <button
        type="button"
        ref={discard}
        onClick={onCancel}
        className={GREY}
        title={t('Discard recording')}
        aria-label={t('Discard recording')}
      >
        <X className="size-4" strokeWidth={2.5} />
      </button>
      {recording ? (
        <>
          <Waveform levels={levels} />
          <span className="shrink-0 text-[13px] tabular-nums text-tertiary">
            {formatElapsed(elapsedMs)}
          </span>
        </>
      ) : (
        <span
          className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-tertiary"
          role="status"
        >
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {t('Transcribing…')}
        </span>
      )}
      <button
        ref={stop}
        type="button"
        onClick={onStop}
        disabled={!recording}
        className={GREY}
        title={`${t('Stop and insert text')} (${SHORTCUT})`}
        aria-label={t('Stop and insert text')}
      >
        <Square className="size-3.5" fill="currentColor" />
      </button>
      <button
        type="button"
        onClick={onSend}
        disabled={!recording}
        className={clsx(ROUND, 'bg-action-primary text-inverse enabled:hover:opacity-90')}
        title={t('Stop and send')}
        aria-label={t('Stop and send')}
      >
        <ArrowUp className="size-4" strokeWidth={2.5} />
      </button>
    </div>
  )
}
