import { useEffect, useState } from 'react'

import { api } from '../api'
import { toast } from '../components/ui/toast'

import type { PosthogScopeCatalog } from '../types'

export function usePosthogScopeCatalog(teamId: string): PosthogScopeCatalog | null {
  const [catalog, setCatalog] = useState<PosthogScopeCatalog | null>(null)

  useEffect(() => {
    let cancelled = false

    api
      .atlasGetPosthogScopeCatalog(teamId)
      .then((result) => {
        if (!cancelled) setCatalog(result)
      })
      .catch((cause: unknown) => {
        if (!cancelled) toast.apiError('Could not load PostHog permissions', cause)
      })

    return () => {
      cancelled = true
    }
  }, [teamId])

  return catalog
}
