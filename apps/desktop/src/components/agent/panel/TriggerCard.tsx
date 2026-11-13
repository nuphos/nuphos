import clsx from 'clsx'
import { AlarmClock, ArrowUpRight } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../../api'
import { useCurrentUser } from '../../../hooks/useCurrentUser'
import { t } from '../../../i18n'
import { useTeamMembers } from '../../../lib/bindingAccess'
import { scheduleSummary } from '../../../views/triggers/cron'
import { viewerTimeZone } from '../../../views/triggers/cronTime'
import { canManageTeamTriggers } from '../../../views/triggers/shared'
import { ConfirmDialog } from '../../ConfirmDialog'
import { Switch } from '../../ui/Switch'
import { toast } from '../../ui/toast'
import { ChatLink } from '../MessageResponse'

import { NextRuns } from './TriggerCardBody'
import { triggerCardInfo } from './triggerCards'
import { cardSchedule } from './triggerSchedule'
import { useTrigger } from './useTrigger'

import type { OpenLink } from './LocalUrlChip'
import type { ToolPart } from './parts'
import type { AgentTrigger } from '../../../api/agent-trigger-types'

const CARD =
  't-chat-card-in w-full max-w-[520px] overflow-hidden rounded-xl border border-line-control bg-state-selected'

function scheduleLine(trigger: AgentTrigger): string {
  if (trigger.triggerType !== 'cron') return scheduleSummary(trigger)

  return cardSchedule(trigger.cronExpression ?? '', viewerTimeZone())
}

function Placeholder({ missing }: { missing: boolean }) {
  return (
    <div className={clsx(CARD, 'flex items-center gap-3 px-3.5 py-3')} aria-busy={!missing}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-tertiary">
        <AlarmClock aria-hidden className="size-4" strokeWidth={1.75} />
      </span>
      {missing ? (
        <span className="text-[12.5px] text-tertiary">
          {t('This trigger is no longer available. It was deleted, or you no longer have access.')}
        </span>
      ) : (
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="h-3 w-40 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
          <span className="h-2.5 w-64 animate-pulse rounded bg-surface-sunken motion-reduce:animate-none" />
        </span>
      )}
    </div>
  )
}

/** A trigger the agent created or changed: its schedule, next runs and on/off. */
export function TriggerCard({
  part,
  teamId,
  onOpen,
}: {
  part: ToolPart
  teamId?: string
  onOpen?: OpenLink
}) {
  const info = triggerCardInfo(part)
  const { trigger, missing, setTrigger } = useTrigger(info?.triggerId ?? null, teamId)
  const [busy, setBusy] = useState(false)
  // The transcript is shared, so turning a live trigger on or off asks first.
  const [switching, setSwitching] = useState<boolean | null>(null)
  const me = useCurrentUser()
  // Viewers may read a trigger but not change it, as on the Triggers page.
  const role = useTeamMembers(teamId ?? '').find(
    (member) => member.id === me?.id && !member.removedAt,
  )?.role
  const canManage = canManageTeamTriggers(role)

  if (!info) return null
  if (!trigger) return <Placeholder missing={missing} />

  const update = async (patch: { enabled: boolean }, failure: string) => {
    setBusy(true)
    try {
      setTrigger(await api.agentUpdateTrigger(trigger.id, patch, teamId))

      return true
    } catch (err) {
      toast.apiError(failure, err)

      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={CARD} aria-label={t('Trigger {name}', { name: trigger.name })}>
      <header className="flex items-start gap-3 px-3.5 pb-2.5 pt-3">
        <span
          className={clsx(
            'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 motion-reduce:transition-none',
            trigger.enabled ? 'bg-state-selected text-primary' : 'bg-surface-sunken text-tertiary',
          )}
        >
          <AlarmClock aria-hidden className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[13.5px] font-medium text-main" title={trigger.name}>
              {trigger.name}
            </span>
            <span className="shrink-0 text-[11.5px] text-tertiary">
              {info.action === 'created' ? t('Created') : t('Updated')}
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-secondary">
            {scheduleLine(trigger)}
          </p>
        </div>
        <Switch
          checked={trigger.enabled}
          disabled={busy || !canManage}
          label={trigger.enabled ? t('Pause this trigger') : t('Resume this trigger')}
          onChange={setSwitching}
        />
      </header>
      <ConfirmDialog
        open={switching !== null}
        title={switching ? t('Resume trigger') : t('Pause trigger')}
        description={
          switching
            ? t('“{name}” will run on its schedule again.', { name: trigger.name })
            : t('“{name}” will stop running until someone resumes it.', { name: trigger.name })
        }
        confirmLabel={switching ? t('Resume') : t('Pause')}
        onConfirm={async () => {
          if (switching === null) return
          await update(
            { enabled: switching },
            switching ? t('Could not resume the trigger') : t('Could not pause the trigger'),
          )
        }}
        onClose={() => setSwitching(null)}
      />
      <div className="border-t border-line-control px-3.5 py-2.5">
        <NextRuns trigger={trigger} />
      </div>
      <footer className="flex items-center justify-end gap-1 border-t border-line-control px-2 py-1.5">
        {teamId && trigger.targetSessionId && (
          <ChatLink
            link={`/teams/${teamId}/agent/${trigger.targetSessionId}`}
            onLinkClick={onOpen}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium text-secondary no-underline hover:bg-state-hover"
          >
            {t('Open conversation')}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </ChatLink>
        )}
      </footer>
    </section>
  )
}
