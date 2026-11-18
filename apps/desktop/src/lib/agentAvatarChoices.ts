import { useSyncExternalStore } from 'react'

// The bot avatar each Agent's owner picked, learned from every conversation
// the client fetches. Rows that only know an Agent's ID (thread badges, agent
// messages) read it from here, so one pick shows everywhere at once.
let picks = new Map<string, string | null>()
// The tint each Bot's face sits on, known and saved together with its face.
let backgrounds = new Map<string, string | null>()
// A fetch can only put back what the server said after a save finished:
// IDs with a save in flight, and when each Agent's last save landed.
const saving = new Map<string, number>()
const savedAt = new Map<string, number>()
const listeners = new Set<() => void>()

function publish(next: Map<string, string | null>, nextBackgrounds = backgrounds) {
  picks = next
  backgrounds = nextBackgrounds
  for (const listener of listeners) listener()
}

/** `requestedAt` is when the fetch that returned these conversations started. */
export function receiveAgentAvatars(
  conversations: { sessionId: string; avatar?: string; avatarBackground?: string }[],
  requestedAt: number,
) {
  let next: Map<string, string | null> | null = null
  let nextBackgrounds: Map<string, string | null> | null = null

  for (const { sessionId, avatar = null, avatarBackground = null } of conversations) {
    if (saving.has(sessionId) || requestedAt < (savedAt.get(sessionId) ?? 0)) continue
    const background = avatar ? avatarBackground : null

    if (picks.get(sessionId) !== avatar) (next ??= new Map(picks)).set(sessionId, avatar)
    if (backgrounds.get(sessionId) !== background)
      (nextBackgrounds ??= new Map(backgrounds)).set(sessionId, background)
  }
  if (next || nextBackgrounds) publish(next ?? picks, nextBackgrounds ?? backgrounds)
}

/**
 * Shows `avatar`, and `background` when given (`none` clears it), right away and
 * puts the previous ones back if `save` fails. A Task has no background.
 */
export async function pickAgentAvatar(
  sessionId: string,
  avatar: string | null,
  save: () => Promise<unknown>,
  background?: string,
) {
  const previous = picks.get(sessionId)
  const previousBackground = backgrounds.get(sessionId)
  const nextBackground =
    avatar === null || background === 'none'
      ? null
      : (background ?? previousBackground ?? null)

  saving.set(sessionId, (saving.get(sessionId) ?? 0) + 1)
  publish(
    new Map(picks).set(sessionId, avatar),
    new Map(backgrounds).set(sessionId, nextBackground),
  )
  try {
    await save()
    savedAt.set(sessionId, Date.now())
  } catch (err) {
    // A later pick that is still saving owns what shows. Unknown stays unknown,
    // so a row falls back to the avatar it was fetched with.
    if (saving.get(sessionId) === 1) {
      const next = new Map(picks)
      const nextBackgrounds = new Map(backgrounds)

      if (previous === undefined) next.delete(sessionId)
      else next.set(sessionId, previous)
      if (previousBackground === undefined) nextBackgrounds.delete(sessionId)
      else nextBackgrounds.set(sessionId, previousBackground)
      publish(next, nextBackgrounds)
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

/** The tint a Bot's face sits on: null for none, undefined before any fetch said. */
export function agentAvatarBackground(agentId: string): string | null | undefined {
  return backgrounds.get(agentId)
}

export function useAgentAvatarBackground(agentId: string): string | null | undefined {
  return useSyncExternalStore(subscribe, () => agentAvatarBackground(agentId))
}

/** Every pick this app knows, for lists that sort agents by whether they have a face. */
export function useAgentAvatarPicks(): ReadonlyMap<string, string | null> {
  return useSyncExternalStore(subscribe, () => picks)
}

/** A Bot: a face, picked in this app since the list loaded (null: taken away) or stored. */
export function isBotRow(
  conversation: { avatar?: string; kind?: string },
  picked?: string | null,
): boolean {
  return Boolean(
    (picked === undefined ? conversation.avatar : picked) && conversation.kind !== 'channel',
  )
}
