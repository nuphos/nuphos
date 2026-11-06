import { useSyncExternalStore } from 'react'

// The bot avatar each Agent's owner picked, learned from every conversation
// the client fetches. Rows that only know an Agent's ID (thread badges, agent
// messages) read it from here, so one pick shows everywhere at once.
let picks = new Map<string, string | null>()
// A fetch can only put back what the server said after a save finished:
// IDs with a save in flight, and when each Agent's last save landed.
const saving = new Map<string, number>()
const savedAt = new Map<string, number>()
const listeners = new Set<() => void>()

function publish(next: Map<string, string | null>) {
  picks = next
  for (const listener of listeners) listener()
}

/** `requestedAt` is when the fetch that returned these conversations started. */
export function receiveAgentAvatars(
  conversations: { sessionId: string; avatar?: string }[],
  requestedAt: number,
) {
  let next: Map<string, string | null> | null = null

  for (const { sessionId, avatar = null } of conversations) {
    if (saving.has(sessionId) || requestedAt < (savedAt.get(sessionId) ?? 0)) continue
    if (picks.get(sessionId) === avatar) continue
    next ??= new Map(picks)
    next.set(sessionId, avatar)
  }
  if (next) publish(next)
}

/** Shows `avatar` right away and puts the previous one back if `save` fails. */
export async function pickAgentAvatar(
  sessionId: string,
  avatar: string | null,
  save: () => Promise<unknown>,
) {
  const previous = picks.get(sessionId)

  saving.set(sessionId, (saving.get(sessionId) ?? 0) + 1)
  publish(new Map(picks).set(sessionId, avatar))
  try {
    await save()
    savedAt.set(sessionId, Date.now())
  } catch (err) {
    // A later pick that is still saving owns what shows. Unknown stays unknown,
    // so a row falls back to the avatar it was fetched with.
    if (saving.get(sessionId) === 1) {
      const next = new Map(picks)

      if (previous === undefined) next.delete(sessionId)
      else next.set(sessionId, previous)
      publish(next)
    }
    throw err
  } finally {
    const left = (saving.get(sessionId) ?? 1) - 1

    if (left) saving.set(sessionId, left)
    else saving.delete(sessionId)
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

/** The picked avatar name, null when none is picked, undefined before any fetch said. */
export function agentAvatarPick(agentId: string): string | null | undefined {
  return picks.get(agentId)
}

export function useAgentAvatarPick(agentId: string): string | null | undefined {
  return useSyncExternalStore(subscribe, () => agentAvatarPick(agentId))
}

/** Every pick this app knows, for lists that sort agents by whether they have a face. */
export function useAgentAvatarPicks(): ReadonlyMap<string, string | null> {
  return useSyncExternalStore(subscribe, () => picks)
}
