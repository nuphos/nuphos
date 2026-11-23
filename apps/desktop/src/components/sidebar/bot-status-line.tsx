import { t } from '../../i18n'

import type { Activity } from './bot-activity'

/** The chat's typing dots, standing in for its newest post while the chat shows them. */
export function TypingPreview() {
  return (
    <span
      role="status"
      aria-label={t('Thinking…')}
      className="inline-flex flex-shrink-0 items-center gap-[3px] rounded-full bg-state-selected px-2 py-[5px] text-tertiary"
    >
      {[0, 160, 320].map((delay) => (
        <span
          key={delay}
          className="t-typing-dot size-1 rounded-full bg-current"
          style={{ animationDelay: `${String(delay)}ms` }}
        />
      ))}
    </span>
  )
}

/**
 * A Bot's preview line while it is in setup. A question stays in the Inbox, and
 * a failed run keeps the chat's newest post: the row's alert mark says it failed.
 */
export function BotStatusLine({ activity }: { activity: Activity }) {
  if (activity.kind === 'onboarding')
    return <span className="truncate text-tertiary">{t('Getting started')}</span>

  return null
}
