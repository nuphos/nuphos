import { CornerUpLeft } from 'lucide-react'

import { t } from '../../i18n'

/** Beside a post, shown while the pointer is over it (`group/post`), as in Slack. */
export function ReplyButton({ onReply }: { onReply: () => void }) {
  return (
    <button
      type="button"
      title={t('Reply')}
      aria-label={t('Reply')}
      onClick={onReply}
      className="inline-flex size-7 shrink-0 items-center justify-center self-center rounded-full text-tertiary opacity-0 transition-opacity hover:bg-state-hover hover:text-main focus-visible:opacity-100 group-hover/post:opacity-100"
    >
      <CornerUpLeft className="size-3.5" strokeWidth={2} />
    </button>
  )
}
