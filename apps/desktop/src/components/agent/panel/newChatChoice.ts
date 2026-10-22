import type { SessionConfigPick } from '../../../api/session-config-types'

/** The agent and model settings the next new chat starts with, saved per team. */
export type NewChatChoice = { runtimeId: string; pick?: SessionConfigPick }
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

// The choice in memory is authoritative and shared by every panel; storage only
// carries it across restarts, so a storage failure never loses a selection.
const choices = new Map<string, NewChatChoice | undefined>()

export function parseNewChatChoice(raw: string | null): NewChatChoice | undefined {
  if (!raw) return undefined
  // Earlier builds saved only the agent id.
  if (!raw.startsWith('{')) return { runtimeId: raw }
  try {
    const value = JSON.parse(raw) as Partial<NewChatChoice> | null

    return typeof value?.runtimeId === 'string'
      ? { runtimeId: value.runtimeId, ...(value.pick ? { pick: value.pick } : {}) }
      : undefined
  } catch {
    return undefined
  }
}

export function readNewChatChoice(key: string, storage: () => Storage = () => localStorage) {
  if (!choices.has(key)) {
    let raw: string | null = null

    try {
      raw = storage().getItem(key)
    } catch {
      /* Storage is optional. */
    }
    choices.set(key, parseNewChatChoice(raw))
  }

  return choices.get(key)
}

export function saveNewChatChoice(
  key: string,
  choice: NewChatChoice,
  storage: () => Storage = () => localStorage,
) {
  choices.set(key, choice)
  try {
    storage().setItem(key, JSON.stringify(choice))
  } catch {
    /* Storage is optional. */
  }
}

/** Model ids belong to one agent, so choosing another agent starts from its defaults. */
export function chooseAgent(choice: NewChatChoice | undefined, runtimeId: string): NewChatChoice {
  return choice?.runtimeId === runtimeId ? choice : { runtimeId }
}
