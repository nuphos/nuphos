import { surfaceOf } from './workspaceState.ts'

import type { WorkspaceState, WorkspaceSurface } from './workspaceState'

const SURFACE_HISTORY_LIMIT = 50

function sameSurfacePlace(a: WorkspaceSurface, b: WorkspaceSurface): boolean {
  return a.sessionId === b.sessionId && a.mainPageOpen === b.mainPageOpen
}

/**
 * Every change of what the main pane shows is recorded here, whichever action
 * made it, so a sidebar click and a link in a message are undone the same way.
 * Going to another chat or to/from the main page is a move. A change of
 * read-only or team in the same place rewrites its entry, and so does leaving a
 * blank New chat: there is nothing on it to come back to, so Back from a chat
 * started there returns to where the user was before.
 */
export function recordSurface(next: WorkspaceState): WorkspaceState {
  const current =
    next.surfaceHistoryIndex >= 0 ? next.surfaceHistory.at(next.surfaceHistoryIndex) : undefined
  const to = surfaceOf(next)

  if (
    current &&
    sameSurfacePlace(current, to) &&
    current.sessionReadOnly === to.sessionReadOnly &&
    current.teamScope?.teamId === to.teamScope?.teamId
  ) {
    return next
  }
  const blankChat = current?.sessionId === null && !current.mainPageOpen && !to.mainPageOpen
  const moved = !current || (!sameSurfacePlace(current, to) && !blankChat)
  const behind = next.surfaceHistory.slice(0, next.surfaceHistoryIndex + 1)
  const surfaceHistory = (moved ? [...behind, to] : [...behind.slice(0, -1), to]).slice(
    -SURFACE_HISTORY_LIMIT,
  )

  return { ...next, surfaceHistory, surfaceHistoryIndex: surfaceHistory.length - 1 }
}

/**
 * Drop history entries Back must not return to — a chat that could not be
 * shown, a team the account left — keeping the cursor on the entry it was on,
 * or the one before it when that entry itself is dropped.
 */
export function retainSurfaces(
  state: WorkspaceState,
  keep: (surface: WorkspaceSurface) => boolean,
): WorkspaceState {
  const surfaceHistory: WorkspaceSurface[] = []
  let surfaceHistoryIndex = -1

  state.surfaceHistory.forEach((surface, index) => {
    const last = surfaceHistory.at(-1)

    if (keep(surface) && !(last && sameSurfacePlace(last, surface))) surfaceHistory.push(surface)
    if (index === state.surfaceHistoryIndex) surfaceHistoryIndex = surfaceHistory.length - 1
  })
  if (surfaceHistory.length === state.surfaceHistory.length) return state

  return { ...state, surfaceHistory, surfaceHistoryIndex }
}

/** A chat the pane could not show: leave it, and drop it from Back/Forward. */
export function forgetSession(state: WorkspaceState, sessionId: string): WorkspaceState {
  const left =
    state.sessionId === sessionId ? { ...state, sessionId: null, sessionReadOnly: false } : state

  return retainSurfaces(left, (surface) => surface.sessionId !== sessionId)
}

/** Back/Forward across chats: move the cursor and show the entry it lands on. */
export function stepSurface(state: WorkspaceState, direction: -1 | 1): WorkspaceState {
  const index = state.surfaceHistoryIndex + direction
  const surface = index >= 0 ? state.surfaceHistory.at(index) : undefined

  return surface ? { ...state, ...surface, surfaceHistoryIndex: index } : state
}
