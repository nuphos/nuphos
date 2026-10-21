// The session token half of the account context (see account-context.ts), for
// whatever only follows the signed-in user: every auth transition (login,
// logout, a switch, a probe that finds the token rejected) lands here, so
// anything bound to "the signed-in user" subscribes once instead of hooking
// each individual login/logout path.

import { AccountContexts } from './account-context.ts'
import { accountContext } from './api-endpoint.ts'

export type AuthSessionListener = (next: string | null, prev: string | null) => void

export class AuthSession {
  private readonly contexts: AccountContexts

  constructor(contexts = new AccountContexts('https://api.nuphos.ai')) {
    this.contexts = contexts
  }

  current(): string | null {
    return this.contexts.current().token
  }

  /** Replaces the token on the current backend. Moving to another backend goes through the context. */
  set(token: string | null): void {
    this.contexts.swap({ api: this.contexts.current().api, token }, 'refresh')
  }

  subscribe(listener: AuthSessionListener): () => void {
    return this.contexts.subscribe((next, prev) => {
      if (next.token !== prev.token) listener(next.token, prev.token)
    })
  }
}

export const authSession = new AuthSession(accountContext)
