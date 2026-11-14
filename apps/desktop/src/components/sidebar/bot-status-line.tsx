import { t } from '../../i18n'

import { chatPreview } from './chat-preview'

import type { Activity } from './bot-activity'

/** The dots a chat shows while an agent types, in a bubble. */
function Dots() {
  return (
    <span className="inline-flex flex-shrink-0 items-center gap-[3px] rounded-full bg-state-selected px-2 py-[5px] text-tertiary">
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
 * A Bot's preview line while it, or one of its sub-agents, is at work: the
 * typing dots and the working run's latest message. A question or a failure
 * says so instead.
 */
export function BotStatusLine({ activity }: { activity: Activity }) {
  if (activity.kind === 'asking')
    return (
      <span className="truncate text-secondary">
        {activity.question
          ? t('Needs your input: {q}', { q: activity.question })
          : t('Needs your input')}
      </span>
    )
  if (activity.kind === 'error')
    return (
      <span className="truncate text-status-danger">
        {activity.label ? `${t('Failed')}: ${activity.label}` : t('Failed')}
      </span>
    )
  if (activity.kind === 'idle') return null
  const message = activity.run?.conversation.lastMessage
  const text =
    (message && chatPreview(message, activity.run?.conversation.faces)) ??
    (activity.kind === 'background' ? t('Working in the background') : t('Thinking…'))

  return (
    <span className="inline-flex max-w-full items-center gap-2 align-top">
      <Dots />
      <span className="truncate text-tertiary">{text}</span>
    </span>
  )
}
