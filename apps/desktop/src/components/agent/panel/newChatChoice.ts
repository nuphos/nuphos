import type { SessionConfigPick } from '../../../api/session-config-types'

/** The agent and model settings the next new chat starts with, saved per team. */
export type NewChatChoice = { runtimeId: string; pick?: SessionConfigPick }

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

/** Model ids belong to one agent, so choosing another agent starts from its defaults. */
export function chooseAgent(choice: NewChatChoice | undefined, runtimeId: string): NewChatChoice {
  return choice?.runtimeId === runtimeId ? choice : { runtimeId }
}
