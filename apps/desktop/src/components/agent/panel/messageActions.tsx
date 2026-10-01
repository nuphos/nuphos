import clsx from 'clsx'
import { Check, Copy, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useCallback, useState } from 'react'

import { toast } from '../../ui/toast'

import { formatMessageTimestamp } from './streamText'

import type { MessageRating } from './model'

// Action row under a completed assistant response. Copy-only for now; the
// layout deliberately leaves room for thumbs up/down + share to slot in later
// without rework.
export function CopyMessageButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1200)
      })
      .catch(() => {
        toast.error('Could not copy message', 'Clipboard was blocked.')
      })
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-zGray-800/60 hover:text-main outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zViolet-accent"
      title={copied ? 'Copied' : 'Copy'}
      aria-label={copied ? 'Copied' : label}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
      )}
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
        title={rating === 'up' ? 'Good response' : 'Bad response'}
        aria-label={rating === 'up' ? 'Good response' : 'Bad response'}
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
      <CopyMessageButton text={text} label="Copy response" />
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
