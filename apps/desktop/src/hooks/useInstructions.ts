import { useEffect, useState } from 'react'

import { api } from '../api'
import { toast } from '../components/ui/toast'

import type { InstructionListing } from '../types/instructions'

export function useInstructions(teamId?: string) {
  const [state, setState] = useState<{
    teamId?: string
    listing: InstructionListing | null
    failed: boolean
  }>({ listing: null, failed: false })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!teamId) return
    let cancelled = false

    api
      .atlasListInstructions(teamId)
      .then((listing) => {
        if (!cancelled) setState({ teamId, listing, failed: false })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        toast.apiError('Couldn’t load instructions', err)
        setState((previous) => ({
          teamId,
          listing: previous.teamId === teamId ? previous.listing : null,
          failed: true,
        }))
      })

    return () => {
      cancelled = true
    }
  }, [teamId, revision])

  const current = state.teamId === teamId

  return {
    listing: current ? state.listing : null,
    loading: Boolean(teamId && !current),
    failed: current && state.failed,
    refresh: () => setRevision((value) => value + 1),
  }
}
