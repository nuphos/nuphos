import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  createSidebarProject,
  onSidebarProjectCreated,
  readSidebarProjects,
  subscribeSidebarProjects,
  syncSidebarProjects,
  updateSidebarProjects,
} from '../../lib/sidebarProjects'
import { toast } from '../ui/toast'

import type { Item } from './types'
import type { SidebarProject, SidebarProjectChange } from '../../lib/sidebarProjects'

export type SidebarProjectsController = {
  list: SidebarProject[]
  projectOf: (sessionId: string) => SidebarProject | undefined
  /** Creates "New project" (optionally holding a chat) and starts renaming it. */
  create: (sessionId?: string) => void
  rename: (id: string, name: string) => void
  remove: (id: string) => void
  move: (sessionId: string, projectId: string | null) => void
  arrange: (ids: string[]) => void
  order: (id: string, sessionIds: string[]) => void
  sortByRecent: (id: string) => void
  /** Opens a new chat that is filed into this project once it is created. */
  newChatIn: (id: string) => void
  /** The project the open new-chat page will be filed into, if any. */
  newChatProjectId: string | null
  /** The project whose name is being edited in place. */
  renamingId: string | null
  setRenamingId: (id: string | null) => void
}

/**
 * "+ New chat" on a project: the chat that the new-chat page creates next is
 * filed there. A chat already in the list is an existing one being opened.
 */
function useNewChatInProject({
  openSessionId,
  newChatActive,
  listedChats,
  onNewChat,
  file,
}: {
  openSessionId: string | null
  newChatActive: boolean
  listedChats: readonly Item[]
  onNewChat: () => void
  file: (sessionId: string, projectId: string) => void
}) {
  const [target, setTarget] = useState<string | null>(null)
  const [seen, setSeen] = useState({ openSessionId, newChatActive })
  const [created, setCreated] = useState<{ sessionId: string; projectId: string } | null>(null)

  if (seen.openSessionId !== openSessionId || seen.newChatActive !== newChatActive) {
    setSeen({ openSessionId, newChatActive })
    const listed = listedChats.some((item) => item.key === `agent-session:${openSessionId ?? ''}`)

    if (target && openSessionId && !seen.openSessionId && !listed)
      setCreated({ sessionId: openSessionId, projectId: target })
    if (!newChatActive) setTarget(null)
  }
  useEffect(() => {
    if (created) file(created.sessionId, created.projectId)
  }, [created, file])

  return {
    newChatIn: (id: string) => {
      setTarget(id)
      onNewChat()
    },
    newChatProjectId: newChatActive ? target : null,
  }
}

/** This person's projects in this team, kept in sync with the server copy. */
export function useSidebarProjects({
  userId,
  teamId,
  ...newChat
}: {
  userId: string
  teamId: string
  openSessionId: string | null
  newChatActive: boolean
  listedChats: readonly Item[]
  onNewChat: () => void
}): SidebarProjectsController {
  const [list, setList] = useState(() => readSidebarProjects(userId, teamId))
  const [scope, setScope] = useState(`${userId}|${teamId}`)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  if (scope !== `${userId}|${teamId}`) {
    setScope(`${userId}|${teamId}`)
    setList(readSidebarProjects(userId, teamId))
    setRenamingId(null)
  }
  useEffect(() => {
    if (!userId || !teamId) return
    void syncSidebarProjects(userId, teamId).catch(() => {
      // Keep the cached list; the next change retries against the server.
    })
    const unsubscribe = subscribeSidebarProjects(userId, teamId, () =>
      setList(readSidebarProjects(userId, teamId)),
    )
    const unwatch = onSidebarProjectCreated(userId, teamId, setRenamingId)

    return () => {
      unsubscribe()
      unwatch()
    }
  }, [teamId, userId])

  const change = useCallback(
    (next: SidebarProjectChange) => {
      updateSidebarProjects(userId, teamId, next).catch((error: unknown) =>
        toast.apiError('Could not save projects', error),
      )
    },
    [teamId, userId],
  )
  const file = useCallback(
    (sessionId: string, projectId: string) => change({ kind: 'move', sessionId, projectId }),
    [change],
  )
  const { newChatIn, newChatProjectId } = useNewChatInProject({ ...newChat, file })

  return useMemo(
    () => ({
      list,
      projectOf: (sessionId) => list.find((project) => project.sessionIds.includes(sessionId)),
      create: (sessionId) => {
        createSidebarProject(userId, teamId, sessionId).saved.catch((error: unknown) =>
          toast.apiError('Could not create project', error),
        )
      },
      rename: (id, name) => change({ kind: 'rename', id, name }),
      remove: (id) => change({ kind: 'delete', id }),
      move: (sessionId, projectId) => change({ kind: 'move', sessionId, projectId }),
      arrange: (ids) => change({ kind: 'arrange', ids }),
      order: (id, sessionIds) => change({ kind: 'order', id, sessionIds }),
      sortByRecent: (id) => change({ kind: 'sortByRecent', id }),
      newChatIn,
      newChatProjectId,
      renamingId,
      setRenamingId,
    }),
    [change, list, newChatIn, newChatProjectId, renamingId, teamId, userId],
  )
}
