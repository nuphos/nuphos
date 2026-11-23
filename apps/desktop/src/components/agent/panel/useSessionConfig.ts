import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { api } from '../../../api'

import { newChatChoiceKey, saveNewChatChoice, sentChatChoice } from './newChatChoice'
import { namesNoModel, refreshLocalModels } from './refreshLocalModels'
import { SessionConfigSync } from './sessionConfigSync'
import { announceSettingsChanged, onSettingsChanged } from './sessionSettingsChanged'
import { announceTimelineChange } from './timelineEvents'

import type { SessionConfigSelection } from '../../../api/session-config-types'

export type ModelSession = {
  sessionId: string
  teamId: string
  runtimeId?: string
  /** Why the viewer may see the model but not change it. */
  lockedHint?: string
}

export function useSessionConfig(session: ModelSession | undefined, streaming: boolean) {
  const [open, setOpen] = useState(false)
  const sessionId = session?.sessionId
  const teamId = session?.teamId
  const runtimeId = session?.runtimeId
  const sync = useMemo(
    () =>
      new SessionConfigSync({
        read: () => api.agentGetSessionConfig(sessionId!, teamId!),
        write: (selection) =>
          api.agentSetSessionConfig(sessionId!, teamId!, selection).then((data) => {
            announceSettingsChanged(sessionId!)
            // The change's line in the transcript (#3699) shows now, not on the next poll.
            announceTimelineChange(sessionId!)

            return data
          }),
      }),
    [sessionId, teamId],
  )
  const state = useSyncExternalStore(sync.subscribe, sync.getSnapshot)
  const unnamed = namesNoModel(state.data)

  useEffect(() => {
    if (sessionId && teamId) return sync.start()
  }, [sync, sessionId, teamId])
  useEffect(() => {
    const refresh = () => void sync.refresh()

    const stopChanged = sessionId ? onSettingsChanged(sessionId, refresh) : undefined

    window.addEventListener('focus', refresh)
    window.addEventListener('nuphos:conversation-runtime-moved', refresh)

    return () => {
      stopChanged?.()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('nuphos:conversation-runtime-moved', refresh)
    }
  }, [sync, sessionId])
  useEffect(() => {
    sync.setStreaming(streaming)
    if (open) void sync.refresh()
  }, [sync, open, streaming])
  useEffect(() => {
    if (unnamed) refreshLocalModels(api.localRuntimeRefreshModels, () => void sync.refresh())
  }, [sync, unnamed])
  // A refused change explains itself while the picker is open; closing it lets
  // the reason go, so reopening starts from the settings the runtime holds.
  useEffect(() => {
    if (!open) sync.dismissWriteError()
  }, [sync, open])

  return {
    ...state,
    open,
    setOpen: (next: boolean) => {
      setOpen(next)
      if (next) refreshLocalModels(api.localRuntimeRefreshModels, () => void sync.refresh())
    },
    select: (selection: SessionConfigSelection) => {
      void sync.select(selection)
    },
    refresh: () => void sync.refresh(),
    /** Cmd+N starts from the chat a message was last sent in. */
    wrapSend:
      <A extends unknown[], R>(send: (...args: A) => R) =>
      (...args: A): R => {
        const choice = sentChatChoice(runtimeId, state.data)

        if (choice) saveNewChatChoice(newChatChoiceKey(teamId), choice)

        return send(...args)
      },
  }
}
