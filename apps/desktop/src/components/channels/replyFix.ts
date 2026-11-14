import type { SignInRoute } from '../agent/panel/agentSignInModel.ts'

/** Why an agent could not reply in a chat, as the server names it. */
export type ReplyFailedCause = 'usage_limit' | 'auth' | 'offline' | 'other'

/**
 * The repair a "couldn't reply" line offers, from the same sign-in route a
 * Task's card takes: sign in again here, ask whoever can, or, for a team
 * runtime an administrator manages, its settings. Usage limits wait for their
 * reset, which the line already says.
 */
export function replyFix(
  cause: ReplyFailedCause | undefined,
  route: SignInRoute['kind'],
  { personalAgent, canOpenSettings }: { personalAgent: boolean; canOpenSettings: boolean },
): 'signIn' | 'ask' | 'settings' | null {
  if (cause === 'auth' && (route === 'cli' || route === 'dialog')) return 'signIn'
  if (cause === 'auth' && route === 'ask') return 'ask'
  if ((cause === 'auth' || cause === 'offline') && !personalAgent && canOpenSettings)
    return 'settings'

  return null
}
