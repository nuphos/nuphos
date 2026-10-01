import { useEffect, useRef, useState } from 'react'

import { api } from '../api'
import { toast } from '../components/ui/toast'

import type { PosthogOAuthInput, PosthogProject } from '../types'

export type PosthogOAuthPhase =
  | { kind: 'form' }
  | { kind: 'waiting' }
  | { kind: 'projects'; bindingId: string; available: PosthogProject[]; selectedIds: number[] }

async function loadProjectChoice(teamId: string, bindingId: string) {
  const [available, integrations] = await Promise.all([
    api.atlasListPosthogAvailableProjects(teamId, bindingId),
    api.atlasListPosthogIntegrations(teamId),
  ])
  const current = integrations.find((row) => row.id === bindingId)?.projects ?? []

  return { available, selectedIds: current.map((project) => project.id) }
}

/**
 * Drives start-oauth → browser consent → deep link. A grant still pending when
 * the dialog unmounts is cancelled so a late approval cannot land unseen.
 */
export function usePosthogOAuth({
  teamId,
  chooseProjects,
  onDone,
}: {
  teamId: string
  chooseProjects: boolean
  onDone: (bindingId: string) => void
}) {
  const [phase, setPhase] = useState<PosthogOAuthPhase>({ kind: 'form' })
  const attemptRef = useRef(0)
  const waitingRef = useRef(false)

  useEffect(() => {
    waitingRef.current = phase.kind === 'waiting'
  }, [phase.kind])
  useEffect(
    () => () => {
      if (!waitingRef.current) return
      attemptRef.current += 1
      void api.atlasCancelPosthogOAuth(teamId).catch(() => {})
    },
    [teamId],
  )

  async function showProjects(attempt: number, bindingId: string) {
    try {
      const choice = await loadProjectChoice(teamId, bindingId)

      if (attempt === attemptRef.current) setPhase({ kind: 'projects', bindingId, ...choice })
    } catch (cause) {
      if (attempt !== attemptRef.current) return
      toast.apiError('PostHog is connected, but its projects could not be listed', cause)
      onDone(bindingId)
    }
  }

  async function authorize(input: PosthogOAuthInput) {
    const attempt = ++attemptRef.current

    setPhase({ kind: 'waiting' })
    try {
      const result = await api.atlasStartPosthogOAuth(teamId, input)

      if (attempt !== attemptRef.current) return
      if (!result.ok) {
        setPhase({ kind: 'form' })
        if (result.error === 'authorization_timeout') {
          toast.error('PostHog authorization timed out', 'Nothing was changed; try again.')
        } else {
          toast.error('Could not connect PostHog', result.description)
        }

        return
      }
      if (chooseProjects) await showProjects(attempt, result.bindingId)
      else onDone(result.bindingId)
    } catch (cause) {
      if (attempt !== attemptRef.current) return
      setPhase({ kind: 'form' })
      toast.apiError('Could not connect PostHog', cause)
    }
  }

  function cancel() {
    attemptRef.current += 1
    setPhase({ kind: 'form' })
    void api.atlasCancelPosthogOAuth(teamId).catch(() => {})
  }

  return { phase, setPhase, authorize, cancel }
}
