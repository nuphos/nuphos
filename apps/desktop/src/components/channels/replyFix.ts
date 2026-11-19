import type { SignInRoute } from '../agent/panel/agentSignInModel.ts'

/** Why an agent could not reply in a chat, as the server names it. */
export type ReplyFailedCause = 'usage_limit' | 'auth' | 'offline' | 'cli' | 'other'

/**
 * The repair a "couldn't reply" line offers, from the same sign-in route a
 * Task's card takes: sign in again here, ask whoever can, or, for a team
 * runtime an administrator manages, its settings. A CLI that would not start is
 * installed again on this computer. Usage limits wait for their reset, which the
 * line already says.
 */
export function replyFix(
  cause: ReplyFailedCause | undefined,
  route: SignInRoute['kind'],
  {
    personalAgent,
    canOpenSettings,
    onThisComputer = false,
  }: { personalAgent: boolean; canOpenSettings: boolean; onThisComputer?: boolean },
): 'signIn' | 'ask' | 'settings' | 'install' | null {
  if (cause === 'cli') return onThisComputer ? 'install' : null
  if (cause === 'auth' && (route === 'cli' || route === 'dialog')) return 'signIn'
  if (cause === 'auth' && route === 'ask') return 'ask'
  if ((cause === 'auth' || cause === 'offline') && !personalAgent && canOpenSettings)
    return 'settings'

  return null
}
