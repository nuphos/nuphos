import { useEffect, useRef, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { nextOccurrencesAfter } from '../../../views/triggers/calendar/occurrences'
import {
  formatViewerRun,
  sourceScheduleRule,
  userScheduleSummary,
} from '../../../views/triggers/scheduleDisplay'
import { Switch } from '../../ui/Switch'
import { NextRuns } from '../panel/TriggerCardBody'
import { pausedNote } from '../panel/triggerCards'

import { SummarySection } from './ChatSummaryRows'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

function nextRunLabel(trigger: AgentTrigger): string {
  if (!trigger.enabled) return pausedNote(trigger)
  if (trigger.nextRunAt)
    return t('Next: {time}', { time: formatViewerRun(new Date(trigger.nextRunAt)) })
  if (trigger.triggerType === 'webhook') return t('Waiting for webhook')

  return t('No upcoming runs')
}

export function ChatSummaryTriggers({
  teamId,
  sessionId,
  onEdit,
}: {
  teamId: string
  sessionId: string
  /** Starts a message asking the agent to change it; without one, the row says to ask here. */
  onEdit?: (message: string) => void
}) {
  const [triggers, setTriggers] = useState<AgentTrigger[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const mounted = useRef(true)
  const revision = useRef(0)
  const updating = useRef(new Set<string>())

  useEffect(() => {
    mounted.current = true
    let active = true
    let timer: ReturnType<typeof setTimeout>

    async function refresh() {
      try {
        const requestedRevision = revision.current
        const rows = await api.agentListTriggers(teamId, sessionId)

        if (active && requestedRevision === revision.current && updating.current.size === 0) {
          setTriggers(rows)
          setLoaded(true)
          setError(false)
        }
      } catch {
        if (active) setError(true)
      } finally {
        if (active) timer = setTimeout(() => void refresh(), 30_000)
      }
    }
    void refresh()

    return () => {
      active = false
      mounted.current = false
      clearTimeout(timer)
    }
  }, [teamId, sessionId])

  async function toggle(trigger: AgentTrigger, enabled: boolean) {
    if (updating.current.has(trigger.id)) return
    revision.current++
    updating.current.add(trigger.id)
    setPending(new Set(updating.current))
    try {
      const updated = await api.agentUpdateTrigger(trigger.id, { enabled }, teamId)

      if (mounted.current) {
        setTriggers((current) =>
          current.map((row) =>
            row.id === trigger.id
              ? {
                  ...row,
                  enabled: updated.enabled,
                  // A person changed it: no reason Nuphos paused it for still applies.
                  executionAuthorizationError: undefined,
                  nextRunAt:
                    enabled && row.triggerType === 'cron'
                      ? nextOccurrencesAfter(
                          row.cronExpression ?? '',
                          new Date(),
                          1,
                          row.timeZone,
                        )[0]?.toISOString()
                      : null,
                }
              : row,
          ),
        )
        setError(false)
      }
    } catch {
      if (mounted.current) setError(true)
    } finally {
      revision.current++
      updating.current.delete(trigger.id)
      if (mounted.current) setPending(new Set(updating.current))
    }
  }

  return (
    <SummarySection title={t('Triggers')}>
      {error && (
        <p role="alert" className="text-xs text-status-danger">
          {t('Could not update triggers. Try again.')}
        </p>
      )}
      {!loaded && !error && <p className="text-xs text-tertiary">{t('Loading…')}</p>}
      {loaded && triggers.length === 0 && (
        <p className="text-xs text-tertiary">{t('Ask here to schedule recurring work.')}</p>
      )}
      {triggers.map((trigger) => (
        <div key={trigger.id} className="py-1">
          <div className="flex items-start gap-3">
            {/* The row opens what the Trigger sends; the switch beside it stays a sibling. */}
            <button
              type="button"
              aria-expanded={openId === trigger.id}
              aria-controls={`trigger-details-${trigger.id}`}
              onClick={() => setOpenId((open) => (open === trigger.id ? null : trigger.id))}
              className="-mx-1.5 min-w-0 flex-1 rounded-md px-1.5 py-1 text-left hover:bg-state-hover"
            >
              <span className="block break-words text-[13px] text-main">{trigger.name}</span>
              <span
                className="mt-1 block text-xs leading-5 text-tertiary"
                title={sourceScheduleRule(trigger)}
              >
                {userScheduleSummary(trigger)}
              </span>
              {(!trigger.enabled || trigger.triggerType !== 'cron') && (
                <span className="block text-xs leading-5 text-tertiary">
                  {nextRunLabel(trigger)}
                </span>
              )}
            </button>
            <span className="pt-1">
              <Switch
                checked={trigger.enabled}
                label={t('Enable {name}', { name: trigger.name })}
                disabled={!trigger.canManage || pending.has(trigger.id)}
                onChange={(enabled) => void toggle(trigger, enabled)}
              />
            </span>
          </div>
          {openId === trigger.id && (
            <div id={`trigger-details-${trigger.id}`} className="mt-1 flex flex-col gap-2 pb-1">
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
                <p className="text-xs leading-5 text-tertiary">
                  {t('Ask here to change this trigger.')}
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </SummarySection>
  )
}
