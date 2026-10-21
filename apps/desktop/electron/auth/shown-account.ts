import { unverifiedTokenSubject } from '../auth-status.ts'

/** An account is a user on a backend: the same user id on another backend is another account. */
function accountOf(token: string | null, api: string): string | null {
  return token ? `${unverifiedTokenSubject(token) ?? ''}@${api}` : null
}

/**
 * Follows the account the windows show. Each session change reports whether
 * it moves away from that account (a switch, an added account, a sign-out),
 * which reloads every window. Signing in from the sign-in screen does not.
 */
export function shownAccount(api: () => string, initial: string | null) {
  let shown = accountOf(initial, api())

  return (next: string | null): boolean => {
    const account = accountOf(next, api())
    const moved = shown !== null && account !== shown

    shown = account

    return moved
  }
}
