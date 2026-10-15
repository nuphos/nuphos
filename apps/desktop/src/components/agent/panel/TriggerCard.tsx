import clsx from 'clsx'
import { AlarmClock, ArrowUpRight, Loader2, Pencil } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../../api'
import { scheduleSummary } from '../../../views/triggers/cron'
import { viewerTimeZone } from '../../../views/triggers/cronTime'
import { Button } from '../../ui/button'
import { Switch } from '../../ui/Switch'
import { toast } from '../../ui/toast'
import { ChatLink } from '../MessageResponse'

import { NextRuns, ScheduleEditor } from './TriggerCardBody'
import { triggerCardInfo } from './triggerCards'
import { cardSchedule } from './triggerSchedule'
import { useTrigger } from './useTrigger'

import type { OpenLink } from './LocalUrlChip'
import type { ToolPart } from './parts'
import type { AgentTrigger } from '../../../api/agent-trigger-types'
import type { KeyboardEvent } from 'react'

const CARD =
  't-chat-card-in w-full max-w-[520px] overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900/60'

function scheduleLine(trigger: AgentTrigger): string {
  if (trigger.triggerType !== 'cron') return scheduleSummary(trigger)

  return cardSchedule(trigger.cronExpression ?? '', viewerTimeZone())
}

function Placeholder({ missing }: { missing: boolean }) {
  return (
    <div className={clsx(CARD, 'flex items-center gap-3 px-3.5 py-3')} aria-busy={!missing}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zGray-800 text-tertiary">
        <AlarmClock aria-hidden className="size-4" strokeWidth={1.75} />
      </span>
      {missing ? (
        <span className="text-[12.5px] text-tertiary">
          This trigger is no longer available. It was deleted, or you no longer have access.
        </span>
      ) : (
        <span className="flex flex-1 flex-col gap-1.5">
          <span className="h-3 w-40 animate-pulse rounded bg-zGray-800 motion-reduce:animate-none" />
          <span className="h-2.5 w-64 animate-pulse rounded bg-zGray-800 motion-reduce:animate-none" />
        </span>
      )}
    </div>
  )
}

/** A cron trigger the agent created or changed: its schedule, next runs, on/off and in-place edit. */
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
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!info) return null
  if (!trigger) return <Placeholder missing={missing} />
  const editing = draft !== null
  const current = trigger.cronExpression ?? ''

  const update = async (patch: { enabled?: boolean; cronExpression?: string }, failure: string) => {
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
  const save = async () => {
    if (draft === null || draft.trim() === current) return setDraft(null)
    if (await update({ cronExpression: draft.trim() }, 'Could not change the schedule')) {
      setDraft(null)
    }
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && editing && !busy) setDraft(null)
  }

  return (
    <section className={CARD} aria-label={`Trigger ${trigger.name}`} onKeyDown={onKeyDown}>
      <header className="flex items-start gap-3 px-3.5 pb-2.5 pt-3">
        <span
          className={clsx(
            'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-150 motion-reduce:transition-none',
            trigger.enabled
              ? 'bg-zViolet-accent/10 text-zViolet-accent'
              : 'bg-zGray-800 text-tertiary',
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
              {info.action === 'created' ? 'Created' : 'Updated'}
            </span>
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-secondary">
            {scheduleLine(trigger)}
          </p>
        </div>
        <Switch
          checked={trigger.enabled}
          disabled={busy}
          label={trigger.enabled ? 'Pause this trigger' : 'Resume this trigger'}
          onChange={(enabled) =>
            void update(
              { enabled },
              enabled ? 'Could not resume the trigger' : 'Could not pause the trigger',
            )
          }
        />
      </header>
      <div className="border-t border-zGray-800 px-3.5 py-2.5">
        {editing ? (
          <ScheduleEditor value={draft} onChange={setDraft} />
        ) : (
          <NextRuns trigger={trigger} />
        )}
      </div>
      <footer className="flex items-center justify-end gap-1 border-t border-zGray-800 px-2 py-1.5">
        {editing ? (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void save()}>
              {busy && (
                <Loader2 aria-hidden className="size-3.5 animate-spin motion-reduce:animate-none" />
              )}
              Save schedule
            </Button>
          </>
        ) : (
          <>
            {teamId && (
              <ChatLink
                link={`/teams/${teamId}/triggers`}
                onLinkClick={onOpen}
                className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[13px] font-medium text-secondary no-underline transition-colors hover:bg-zGray-800 hover:text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zViolet-accent"
              >
                All triggers
                <ArrowUpRight aria-hidden className="size-3.5" />
              </ChatLink>
            )}
            {trigger.triggerType === 'cron' && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(current)}>
                <Pencil aria-hidden className="size-3.5" />
                Edit schedule
              </Button>
            )}
          </>
        )}
      </footer>
    </section>
  )
}
