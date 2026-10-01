import { Loader2, Pencil, Play } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { AgentPanel } from '../../components/agent/AgentPanel'
import { Button } from '../../components/ui/button'
import { useToolbarSlot } from '../../hooks/useToolbarControls'
import { useResetOnKey } from '../useResetOnKey'

import { scheduleSummary } from './cron'
import { Toggle } from './parts'
import { testFireTrigger } from './triggerFormActions'
import { TriggerRunsList } from './TriggerRunsList'

import type { AgentTrigger } from '../../api'

// A manual fire returns as soon as the run is queued; the conversation it
// creates appears a moment later. Re-listing on a short leash for a while is
// what turns "nothing happened" into a row showing up.
const FIRE_POLL_MS = 3_000
const FIRE_POLL_WINDOW_MS = 90_000

/**
 * A trigger, as the thing it produces rather than the form that configures it.
 *
 * Its runs are ordinary conversations that happen to have been started by a
 * schedule or a webhook, so they are listed and read with the same components
 * the Chats reader uses. The page carries no title or back button: the trigger
 * lives on the workspace breadcrumb, which names it and whose Triggers crumb
 * goes back. Its actions ride the toolbar for the same reason.
 */
export function TriggerDetail({
  trigger,
  listStatus,
  teamId,
  canManage,
  isActive,
  filter,
  onCount,
  onRetry,
  onEdit,
  onToggle,
}: {
  trigger?: AgentTrigger
  /** Whether the list this trigger comes from has arrived yet. */
  listStatus: 'loading' | 'ready' | 'error'
  teamId: string
  canManage: boolean
  /** A keep-alive'd background tab must not leak its actions into the toolbar. */
  isActive: boolean
  /** The workspace toolbar's search box, searching this trigger's runs. */
  filter: string
  onCount?: (n: number) => void
  onRetry: () => void
  onEdit: () => void
  onToggle: (enabled: boolean) => void | Promise<void>
}) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [firing, setFiring] = useState(false)
  const [runsKey, setRunsKey] = useState(0)
  // Set on a manual fire; drives the short re-listing window above.
  const [firedAt, setFiredAt] = useState<number | null>(null)
  const actionsSlot = useToolbarSlot('right', isActive && Boolean(trigger))

  // Switching triggers must not leave the previous one's run open beside the
  // new one's list.
  useResetOnKey(trigger?.id ?? '', () => {
    setSelectedSessionId(null)
    setFiredAt(null)
  })

  useEffect(() => {
    if (firedAt === null) return
    const timer = window.setInterval(() => {
      if (Date.now() - firedAt > FIRE_POLL_WINDOW_MS) {
        setFiredAt(null)

        return
      }
      setRunsKey((key) => key + 1)
    }, FIRE_POLL_MS)

    return () => window.clearInterval(timer)
  }, [firedAt])

  const onListLoaded = useCallback(
    (items: { sessionId: string }[]) => {
      // Only fills an empty reader: once something is open, a background
      // refresh must not yank the transcript out from under whoever is
      // reading it.
      setSelectedSessionId((current) => current ?? items[0]?.sessionId ?? null)
      onCount?.(items.length)
    },
    [onCount],
  )

  if (!trigger) {
    // "Not found" is only true once the list has actually arrived. Saying it
    // while the fetch is still in flight — which is every arrival on this page,
    // and every tab restore — accuses the app of losing something it simply
    // hasn't read yet.
    if (listStatus === 'loading') {
      return (
        <div className="flex flex-1 items-center justify-center text-tertiary">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )
    }
    if (listStatus === 'error') {
      return (
        <div className="p-5 text-[12.5px] text-error">
          Could not load triggers.
          <button
            type="button"
            onClick={onRetry}
            className="ml-2 underline text-secondary hover:text-main"
          >
            Retry
          </button>
        </div>
      )
    }

    return (
      <div className="p-5 text-[12.5px] text-error">
        Trigger not found. It may have been deleted.
      </div>
    )
  }

  const cleanupPending = Boolean(trigger.cleanupStatus)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {actionsSlot &&
        createPortal(
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!canManage || firing || cleanupPending}
              onClick={() => {
                void testFireTrigger({
                  triggerId: trigger.id,
                  teamId,
                  canManage,
                  setFiring,
                }).then(() => {
                  setFiredAt(Date.now())
                  setRunsKey((key) => key + 1)
                })
              }}
              title="Fire this trigger once, now"
            >
              {firing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" strokeWidth={1.8} />
              )}
              Run now
            </Button>
            <Toggle
              enabled={trigger.enabled}
              disabled={!canManage || cleanupPending}
              onChange={(enabled) => void onToggle(enabled)}
            />
            <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} />
              Edit
            </Button>
          </div>,
          actionsSlot,
        )}

      <div className="flex min-h-0 flex-1">
        <TriggerRunsList
          teamId={teamId}
          triggerIds={[trigger.id]}
          schedule={scheduleSummary(trigger)}
          query={filter}
          refreshKey={runsKey}
          selectedSessionId={selectedSessionId}
          onOpenRun={setSelectedSessionId}
          onListLoaded={onListLoaded}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedSessionId ? (
            <AgentPanel
              key={`trigger-run-${trigger.id}`}
              variant="page"
              open
              teamId={teamId}
              sessionId={selectedSessionId}
              onSessionChange={setSelectedSessionId}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-[12.5px] text-tertiary">
              {firedAt !== null
                ? 'Starting a run — it will appear on the left shortly.'
                : 'Pick a run to read it, or press Run now to start one.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
