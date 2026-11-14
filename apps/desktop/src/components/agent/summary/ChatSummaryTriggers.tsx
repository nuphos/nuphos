import { useEffect, useRef, useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { nextOccurrencesAfter } from '../../../views/triggers/calendar/occurrences'
import { scheduleSummary } from '../../../views/triggers/cron'
import { Switch } from '../../ui/Switch'

import { SummarySection } from './ChatSummaryRows'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

function nextRunLabel(trigger: AgentTrigger): string {
  if (!trigger.enabled) return t('Paused')
  if (trigger.nextRunAt)
    return t('Next: {time}', { time: new Date(trigger.nextRunAt).toLocaleString() })
  if (trigger.triggerType === 'webhook') return t('Waiting for webhook')

  return t('No upcoming runs')
}

export function ChatSummaryTriggers({ teamId, sessionId }: { teamId: string; sessionId: string }) {
  const [triggers, setTriggers] = useState<AgentTrigger[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [pending, setPending] = useState<Set<string>>(new Set())
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
        <p className="text-xs text-tertiary">
          {t('Ask the agent to schedule recurring work in this conversation.')}
        </p>
      )}
      {triggers.map((trigger) => (
        <div key={trigger.id} className="flex items-start gap-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="break-words text-[13px] text-main">{trigger.name}</p>
            <p className="mt-1 text-xs leading-5 text-tertiary">
              {trigger.scheduleDescription ?? scheduleSummary(trigger)}
            </p>
            <p className="text-xs leading-5 text-tertiary">{nextRunLabel(trigger)}</p>
          </div>
          <Switch
            checked={trigger.enabled}
            label={t('Enable {name}', { name: trigger.name })}
            disabled={!trigger.canManage || pending.has(trigger.id)}
            onChange={(enabled) => void toggle(trigger, enabled)}
          />
        </div>
      ))}
    </SummarySection>
  )
}
