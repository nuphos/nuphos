import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { api } from '../../../api'

import { confirmedChoice, newChatChoiceKey, saveNewChatChoice } from './newChatChoice'
import { SessionConfigSync } from './sessionConfigSync'

import type { SessionConfigSelection } from '../../../api/session-config-types'

export type ModelSession = { sessionId: string; teamId: string; runtimeId?: string }

export function useSessionConfig(session: ModelSession | undefined, streaming: boolean) {
  const [open, setOpen] = useState(false)
  const sessionId = session?.sessionId
  const teamId = session?.teamId
  const runtimeId = session?.runtimeId
  const sync = useMemo(
    () =>
      new SessionConfigSync({
        read: () => api.agentGetSessionConfig(sessionId!, teamId!),
        write: async (selection) => {
          const data = await api.agentSetSessionConfig(sessionId!, teamId!, selection)

          // Cmd+N starts from the last settings chosen, here or on a new chat.
          if (runtimeId)
            saveNewChatChoice(newChatChoiceKey(teamId), confirmedChoice(runtimeId, data.options))

          return data
        },
      }),
    [sessionId, teamId, runtimeId],
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
    open,
    setOpen,
    select: (selection: SessionConfigSelection) => {
      void sync.select(selection)
    },
    refresh: () => void sync.refresh(),
  }
}
