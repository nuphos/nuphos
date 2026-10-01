import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { useSlowPoll } from '../../hooks/useSlowPoll'

import type { GithubPRDetail, GithubRepository } from '../../types'

export function useGithubPull(
  teamId: string,
  installationId: number,
  repo: GithubRepository,
  pullNumber: number,
  refreshKey: number,
) {
  const [pull, setPull] = useState<GithubPRDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reqRef = useRef(0)
  const [owner] = repo.fullName.split('/')
  const repoName = repo.name

  const load = useCallback(
    (background: boolean) => {
      const req = ++reqRef.current

      api
        .atlasGetGithubPull(teamId, installationId, owner, repoName, pullNumber)
        .then((detail) => {
          if (req !== reqRef.current) return
          setError(null)
          setPull(detail)
        })
        .catch((reason: unknown) => {
          if (req !== reqRef.current || background) return
          setError(String(reason instanceof Error ? reason.message : reason))
        })
    },
    [teamId, installationId, owner, repoName, pullNumber],
  )

  useEffect(() => {
    load(false)
  }, [load, refreshKey])
  useSlowPoll(() => {
    if (pull && !error) load(true)
  })

  return { pull, error }
}
