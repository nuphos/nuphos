import { Loader2, MessageSquareOff, SquarePen } from 'lucide-react'

import { t } from '../../../i18n'
import { EmptyState } from '../../EmptyState'

type Props = {
  /** The chat could not be read: private to others, or deleted. */
  unavailable: boolean
  onNewChat: () => void
}

/**
 * What the conversation page shows while it has no transcript: the spinner of
 * an open in flight, or why a chat cannot be opened. The backend answers a
 * private chat and a deleted one the same way, so one message covers both, and
 * it names nothing about the chat itself.
 */
export function ConversationPlaceholder({ unavailable, onNewChat }: Props) {
  if (unavailable) {
    return (
      <EmptyState
        icon={MessageSquareOff}
        title={t('You can’t open this chat')}
        description={t(
          'It may be private, or it may have been deleted. If someone shared it with you, ask them to invite you.',
        )}
        primaryAction={{ label: t('New agent'), icon: SquarePen, onClick: onNewChat }}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center" aria-busy="true">
      <Loader2
        className="h-4 w-4 animate-spin text-tertiary/70"
        strokeWidth={1.7}
        aria-hidden="true"
      />
      <span className="sr-only">{t('Opening agent')}</span>
    </div>
  )
}
