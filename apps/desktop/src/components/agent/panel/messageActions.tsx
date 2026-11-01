import clsx from 'clsx'
import { Check, Copy, Pencil, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { t } from '../../../i18n'
import { comboText, isMac } from '../../../lib/platform'
import { toast } from '../../ui/toast'

import { isCopyReplyKey } from './copyReplyKey'
import { ownsShortcut } from './modelSelectorParts'
import { formatMessageTimestamp } from './streamText'

import type { MessageRating } from './model'

// Action row under a completed assistant response. Copy-only for now; the
// layout deliberately leaves room for thumbs up/down + share to slot in later
// without rework.
export function CopyMessageButton({
  text,
  label,
  shortcut = false,
}: {
  text: string
  label: string
  /** The latest reply answers ⌥⌘C in the panel holding focus. */
  shortcut?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const idleTitle = shortcut
    ? t('Copy ({shortcut})', { shortcut: comboText('mod+alt+c') })
    : t('Copy')
  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {
        toast.error(t('Could not copy message'), t('Clipboard was blocked.'))
      })
  }, [text])

  useEffect(() => {
    if (!shortcut) return
    const onKeyDown = (event: KeyboardEvent) => {
      const button = buttonRef.current

      if (event.defaultPrevented || !isCopyReplyKey(event, isMac)) return
      if (!button || !ownsShortcut(button, '[data-copy-latest]')) return
      event.preventDefault()
      handleCopy()
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcut, handleCopy])

  return (
    <button
      ref={buttonRef}
      type="button"
      data-copy-latest={shortcut ? '' : undefined}
      onClick={handleCopy}
      className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-main outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zViolet-accent"
      title={copied ? t('Copied') : idleTitle}
      aria-label={copied ? t('Copied') : label}
    >
      <span className="t-icon-swap" data-state={copied ? 'b' : 'a'}>
        <span className="t-icon" data-icon="a">
          <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
        </span>
        <span className="t-icon" data-icon="b">
          <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
        </span>
      </span>
    </button>
  )
}

export function EditMessageButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-main outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zViolet-accent"
      title={t('Edit')}
      aria-label={t('Edit message')}
    >
      <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
    </button>
  )
}

// Copy / thumbs / timestamp row under an assistant reply. Hidden until the
// turn is hovered, except on the conversation's latest reply where the
// buttons stay visible (the timestamp is still hover-only there).
export function AssistantMessageActions({
  text,
  createdAt,
  feedback,
  alwaysVisible,
  onSelectRating,
}: {
  text: string
  createdAt?: number
  feedback?: MessageRating
  alwaysVisible: boolean
  onSelectRating?: (rating: MessageRating | null) => void
}) {
  const ratingButton = (rating: MessageRating) => {
    const selected = feedback === rating
    const Icon = rating === 'up' ? ThumbsUp : ThumbsDown

    return (
      <button
        type="button"
        onClick={() => onSelectRating?.(selected ? null : rating)}
        className={clsx(
          'flex h-7 w-7 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zViolet-accent',
          selected
            ? 'bg-zGray-800/80 text-main'
            : 'text-tertiary hover:bg-zGray-800/60 hover:text-main',
        )}
        title={rating === 'up' ? t('Good response') : t('Bad response')}
        aria-label={rating === 'up' ? t('Good response') : t('Bad response')}
        aria-pressed={selected}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.8} fill={selected ? 'currentColor' : 'none'} />
      </button>
    )
  }

  return (
    <div
      className={clsx(
        'flex items-center gap-0.5 pt-0.5 transition-opacity',
        !alwaysVisible &&
          'opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100',
      )}
    >
      <CopyMessageButton text={text} label={t('Copy response')} shortcut={alwaysVisible} />
      {onSelectRating && ratingButton('up')}
      {onSelectRating && ratingButton('down')}
      {typeof createdAt === 'number' && (
        <span
          className={clsx(
            'pl-1.5 text-[11px] text-tertiary tabular-nums',
            alwaysVisible &&
              'opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100 transition-opacity',
          )}
        >
          {formatMessageTimestamp(createdAt)}
        </span>
      )}
    </div>
  )
}
