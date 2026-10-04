import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { api } from '../../../api'

import { SessionConfigSync } from './sessionConfigSync'

import type { SessionConfigSelection } from '../../../api/session-config-types'

export type ModelSession = { sessionId: string; teamId: string; initialModelName?: string }

export function useSessionConfig(session: ModelSession | undefined, streaming: boolean) {
  const [open, setOpen] = useState(false)
  const sessionId = session?.sessionId
  const teamId = session?.teamId
  const sync = useMemo(
    () =>
      new SessionConfigSync({
        read: () => api.agentGetSessionConfig(sessionId!, teamId!),
        write: (selection) => api.agentSetSessionConfig(sessionId!, teamId!, selection),
      }),
    [sessionId, teamId],
  )
  const state = useSyncExternalStore(sync.subscribe, sync.getSnapshot)

  useEffect(() => {
    if (sessionId && teamId) return sync.start()
  }, [sync, sessionId, teamId])
  useEffect(() => {
    const refresh = () => void sync.refresh()

    window.addEventListener('focus', refresh)
    window.addEventListener('nuphos:conversation-runtime-moved', refresh)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('nuphos:conversation-runtime-moved', refresh)
    }
  }, [sync])
  useEffect(() => {
    sync.setStreaming(streaming)
    if (open) void sync.refresh()
  }, [sync, open, streaming])

  return {
    ...state,
    initialModelName: session?.initialModelName,
    open,
    setOpen,
    select: (selection: SessionConfigSelection) => {
      void sync.select(selection)
    },
    refresh: () => void sync.refresh(),
  }
}
