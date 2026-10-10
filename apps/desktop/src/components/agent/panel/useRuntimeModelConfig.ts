import { useEffect, useState } from 'react'

import { api } from '../../../api'

import type { ModelControl } from './ModelSelector'
import type { SessionConfigPick, SessionConfigState } from '../../../api/session-config-types'

type Result = { key: string; runtimeId: string; data?: SessionConfigState; error?: string }

/** Model settings for a conversation that has no session yet, read from the
 *  runtime itself. Picks stay with the caller and go out with the first
 *  message; the server keeps only those the runtime offers. */
export function useRuntimeModelConfig(
  teamId: string | undefined,
  runtimeId: string | undefined,
  pick: SessionConfigPick,
  onPick: (pick: SessionConfigPick) => void,
): ModelControl {
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<Result>()
  const key = JSON.stringify([teamId, runtimeId, pick, revision])

  useEffect(() => {
    if (!teamId || !runtimeId) return
    let cancelled = false

    api.atlasGetRuntimeModelConfig(teamId, runtimeId, pick).then(
      (data) => {
        if (!cancelled) setResult({ key, runtimeId, data })
      },
      () => {
        // Unreachable reads as offline, like a conversation's agent would.
        if (!cancelled)
          setResult({
            key,
            runtimeId,
            data: { status: 'offline', options: [] },
            error: 'Could not load models. Check the agent connection and retry.',
          })
      },
    )

    return () => {
      cancelled = true
    }
  }, [teamId, runtimeId, pick, key])

  const shown = result?.runtimeId === runtimeId ? result : undefined
  const pending = shown?.key !== key

  return {
    // The last list stays visible while a refresh or a pick is in flight.
    data: shown?.data,
    loading: !shown,
    slow: false,
    saving: Boolean(shown) && pending,
    error: pending ? undefined : shown?.error,
    stalled: false,
    queued: undefined,
    open,
    setOpen: (next: boolean) => {
      setOpen(next)
      if (next) setRevision((previous) => previous + 1)
    },
    select: ({ configId, value }) => onPick({ ...pick, [configId]: value }),
    refresh: () => setRevision((previous) => previous + 1),
  }
}
