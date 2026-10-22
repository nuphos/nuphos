import { useEffect, useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'

import { boxUpdateConfirm } from './boxRestartPresentation'

/**
 * A Box's host update, on the card itself: its agents' own pages hide with them when they
 * are signed out. Every agent on a Box reports its host's update, so any of them asks.
 */
export function BoxHostUpdate({
  teamId,
  boxLabel,
  runtimeId,
  busy,
  onUpdate,
}: {
  teamId: string
  boxLabel: string
  runtimeId: string
  busy: boolean
  onUpdate: () => void
}) {
  const [update, setUpdate] = useState<{ runtimeId: string; version?: string }>()
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    let cancelled = false

    api.atlasGetRuntimeInstanceStatus(teamId, runtimeId).then(
      ({ runtimeUpdate }) => {
        if (cancelled) return
        if (runtimeUpdate?.state === 'available' || runtimeUpdate?.state === 'failed')
          setUpdate({ runtimeId, version: runtimeUpdate.latestVersion })
      },
      () => null,
    )

    return () => {
      cancelled = true
    }
  }, [teamId, runtimeId])

  if (update?.runtimeId !== runtimeId) return null

  return (
    <>
      <button
        type="button"
        className="ml-auto shrink-0 rounded border border-zViolet-500/30 px-1.5 text-[10px] text-zViolet-400 hover:bg-zViolet-500/10"
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        Update{update.version && ` · v${update.version}`}
      </button>
      <ConfirmDialog
        open={confirming}
        {...boxUpdateConfirm(boxLabel, update.version)}
        onConfirm={onUpdate}
        onClose={() => setConfirming(false)}
      />
    </>
  )
}
