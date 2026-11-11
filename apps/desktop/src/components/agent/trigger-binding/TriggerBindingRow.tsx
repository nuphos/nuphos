import clsx from 'clsx'
import { AlarmClock, ArrowUpRight, MoreHorizontal, Pause, Play, Zap } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../../api'
import { locale, t } from '../../../i18n'
import { viewerTimeZone } from '../../../views/triggers/cronTime'
import { testFireTrigger } from '../../../views/triggers/triggerFormActions'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../ui/menu'
import { StatusDot } from '../../ui/status-dot'
import { toast } from '../../ui/toast'

import { lastRunState, scheduledNote } from './bindings'
import { refreshTriggerBindings, replaceTriggerBinding } from './bindingStore'
import { openTriggerInSettings } from './triggerLinks'

import type { AgentTrigger } from '../../../api/agent-trigger-types'

/**
 * One Trigger delivering into this conversation, on one line. The row opens it
 * in Triggers; its menu runs, pauses or resumes it.
 */
export function TriggerBindingRow({
  trigger,
  teamId,
  canManage,
  now,
}: {
  trigger: AgentTrigger
  teamId: string
  canManage: boolean
  now: Date
}) {
  const [busy, setBusy] = useState(false)
  const failed = lastRunState(trigger) === 'failed'
  const cleanupPending = Boolean(trigger.cleanupStatus)
  const open = () =>
    openTriggerInSettings(teamId, { triggerId: trigger.id, triggerName: trigger.name })

  const toggle = async () => {
    const enabled = !trigger.enabled

    setBusy(true)
    try {
      replaceTriggerBinding(teamId, await api.agentUpdateTrigger(trigger.id, { enabled }, teamId))
    } catch (err) {
      toast.apiError(
        enabled ? t('Could not resume the trigger') : t('Could not pause the trigger'),
        err,
      )
    } finally {
      setBusy(false)
    }
  }
  const runNow = () =>
    void testFireTrigger({ triggerId: trigger.id, teamId, canManage, setFiring: setBusy }).then(
      () => refreshTriggerBindings(teamId, true),
    )

  return (
    <div
      data-testid="chat-trigger-row"
      className={clsx(
        'group -mx-1.5 flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 transition-colors hover:bg-state-hover focus-within:bg-state-hover motion-reduce:transition-none',
        !trigger.enabled && 'opacity-50',
      )}
    >
      <button
        type="button"
        title={t('Open in Triggers')}
        onClick={open}
        className="flex min-w-0 flex-1 items-center gap-3 text-left text-[13px] text-main outline-none"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-tertiary">
          <AlarmClock aria-hidden className="size-3.5" />
        </span>
        <span className="min-w-0 truncate">{trigger.name}</span>
        {failed && <StatusDot tone="danger" label={t('The last run failed')} />}
        <span className="ml-auto shrink-0 pl-2 text-[12px] tabular-nums text-tertiary">
          {scheduledNote(trigger, now, viewerTimeZone(), locale)}
        </span>
      </button>
      <Menu>
        <MenuTrigger
          aria-label={t('More actions for {title}', { title: trigger.name })}
          className="hidden size-6 shrink-0 items-center justify-center rounded-md text-tertiary outline-none transition-colors hover:text-main focus-visible:flex focus-visible:ring-1 focus-visible:ring-line-focus group-focus-within:flex group-hover:flex data-[popup-open]:flex data-[popup-open]:bg-state-selected data-[popup-open]:text-main motion-reduce:transition-none"
        >
          <MoreHorizontal aria-hidden className="size-3.5" />
        </MenuTrigger>
        <MenuContent align="end" className="w-[180px]">
          <MenuItem
            icon={<Zap className="h-3.5 w-3.5" />}
            disabled={!canManage || busy || cleanupPending}
            onClick={runNow}
          >
            {t('Run now')}
          </MenuItem>
          <MenuItem
            icon={
              trigger.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />
            }
            disabled={!canManage || busy || cleanupPending}
            onClick={() => void toggle()}
          >
            {trigger.enabled ? t('Pause') : t('Resume')}
          </MenuItem>
          <MenuItem icon={<ArrowUpRight className="h-3.5 w-3.5" />} onClick={open}>
            {t('Open in Triggers')}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}
