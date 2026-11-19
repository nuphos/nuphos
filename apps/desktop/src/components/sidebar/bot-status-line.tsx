import { t } from '../../i18n'

import type { Activity } from './bot-activity'

/** The dots a chat shows while an agent types, in a bubble. */
function Dots() {
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
 * A Bot's preview line while it, or one of its sub-agents, is at work: the
 * work dots alone, without unrelated Task transcript text. A question or a failure
 * says so instead.
 */
export function BotStatusLine({ activity }: { activity: Activity }) {
  if (activity.kind === 'onboarding')
    return <span className="truncate text-tertiary">{t('Getting started')}</span>
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
  if (activity.kind === 'background')
    return <span className="truncate text-tertiary">{t('Working in the background')}</span>

  return <Dots />
}
