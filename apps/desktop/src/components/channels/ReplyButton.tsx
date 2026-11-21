import clsx from 'clsx'
import { CornerUpLeft } from 'lucide-react'

import { t } from '../../i18n'

/**
 * Beside a post, shown while the pointer is over it (`group/post`), as in Slack.
 * `side` pins it to the middle of the bubble's height, just outside the edge
 * named; without it the button sits in the row, centred on the whole post.
 */
export function ReplyButton({ onReply, side }: { onReply: () => void; side?: 'left' | 'right' }) {
  const edge = side === 'right' ? 'left-full ml-2.5' : 'right-full mr-2.5'

  return (
    <button
      type="button"
      title={t('Reply')}
      aria-label={t('Reply')}
      onClick={onReply}
      className={clsx(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-tertiary opacity-0 transition-opacity hover:bg-state-hover hover:text-main focus-visible:opacity-100 group-hover/post:opacity-100',
        side ? `absolute top-1/2 -translate-y-1/2 ${edge}` : 'self-center',
      )}
    >
      <CornerUpLeft className="size-3.5" strokeWidth={2} />
    </button>
  )
}
