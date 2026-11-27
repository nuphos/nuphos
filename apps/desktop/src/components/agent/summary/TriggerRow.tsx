import { clsx } from 'clsx'
import { AlarmClock } from 'lucide-react'

import { t } from '../../../i18n'
import { viewerTimeZone } from '../../../views/triggers/cronTime'
import { Switch } from '../../ui/Switch'
import { NextRuns } from '../panel/TriggerCardBody'
import { untilRun } from '../panel/triggerCards'
import { triggerSchedule } from '../panel/triggerSchedule'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

/**
 * What the row adds after its schedule, kept short so the line does not wrap: when it runs next,
 * or that it waits for a webhook. The switch already says a trigger is off.
 */
function nextRunLabel(trigger: AgentTrigger, now: Date): string | null {
  if (!trigger.enabled) return null
  if (trigger.nextRunAt)
    return t('Next: {time}', { time: untilRun(new Date(trigger.nextRunAt), now) })
  if (trigger.triggerType === 'webhook') return t('Waiting for webhook')

  return t('No upcoming runs')
}

/** One Trigger: its name and schedule on a line each, its switch beside them, what it sends under. */
export function TriggerRow({
  trigger,
  open,
  busy,
  onToggleOpen,
  onToggle,
  onEdit,
  askHint,
}: {
  trigger: AgentTrigger
  open: boolean
  busy: boolean
  onToggleOpen: () => void
  onToggle: (enabled: boolean) => void
  onEdit?: (message: string) => void
  /** Where to ask for a change when there is no Edit. */
  askHint?: string
}) {
  const schedule = triggerSchedule(trigger, viewerTimeZone())
  const next = nextRunLabel(trigger, new Date())

  return (
    <div>
      <div className="flex items-center gap-2">
        {/* The row opens what the Trigger sends; the switch beside it stays a sibling. */}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`trigger-details-${trigger.id}`}
          title={next ? `${schedule} · ${next}` : schedule}
          onClick={onToggleOpen}
          className="-mx-1.5 flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-state-hover"
        >
          <AlarmClock
            aria-hidden
            strokeWidth={1.75}
            className={clsx(
              'size-4 shrink-0',
              trigger.enabled ? 'text-secondary' : 'text-tertiary',
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] leading-5 text-main">{trigger.name}</span>
            <span className="flex min-w-0 text-xs leading-4 text-tertiary">
              <span className="truncate">{schedule}</span>
              {next && <span className="shrink-0">&nbsp;·&nbsp;{next}</span>}
            </span>
          </span>
        </button>
        <Switch
          checked={trigger.enabled}
          label={t('Enable {name}', { name: trigger.name })}
          disabled={!trigger.canManage || busy}
          onChange={onToggle}
        />
      </div>
      {/* Nuphos paused it for a reason the owner has to act on: that one is worth its lines. */}
      {!trigger.enabled && trigger.executionAuthorizationError && (
        <p className="mt-0.5 pl-[26px] text-xs leading-5 text-status-warning">
          {trigger.executionAuthorizationError}
        </p>
      )}
      {open && (
        <div
          id={`trigger-details-${trigger.id}`}
          className="mt-1 flex flex-col gap-2 pb-2 pl-[26px]"
        >
          <p className="whitespace-pre-wrap break-words rounded-md bg-surface-sunken px-2 py-1.5 text-xs leading-5 text-secondary">
            {trigger.messageTemplate}
          </p>
          {/* A paused row already says why above. */}
          {trigger.triggerType === 'cron' && trigger.enabled && <NextRuns trigger={trigger} />}
          {onEdit ? (
            <button
              type="button"
              onClick={() => onEdit(t('Edit your trigger “{name}”: ', { name: trigger.name }))}
              className="self-start rounded-md border border-line-control px-2.5 py-1 text-xs font-medium text-secondary hover:bg-state-hover hover:text-main"
            >
              {t('Edit')}
            </button>
          ) : (
            askHint && <p className="text-xs leading-5 text-tertiary">{askHint}</p>
          )}
        </div>
      )}
    </div>
  )
}
