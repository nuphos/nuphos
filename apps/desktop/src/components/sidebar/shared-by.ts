import type { AgentConversationPerson } from '../../api/agent-types.ts'

/** The name the backend gives an owner it could not resolve; other views show it as is. */
export const UNRESOLVED_OWNER_NAME = 'Unknown user'

/** Who a shared agent is credited to: the owner's name, else their email. */
export function sharerName(
  owner: Pick<AgentConversationPerson, 'name' | 'email'> | undefined,
): string | undefined {
  const name = owner?.name.trim()

  // The placeholder names no one, so the email or "a teammate" says more.
  if (name && name !== UNRESOLVED_OWNER_NAME) return name
  const email = owner?.email.trim()

  if (email) return email

  return undefined
}
