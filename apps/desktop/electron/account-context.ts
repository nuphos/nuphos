// The account this app acts as: one immutable value pairing a backend with the
// session token issued by it. Every change replaces the whole value at once and
// says why, so nothing ever observes a token paired with another backend, and
// anything that belongs to an account is ended when the app leaves it.
//
// Pure: no electron, fs or env, so it can be unit-tested directly.

import { unverifiedTokenSubject } from './auth-status.ts'

/** Why the account changed. A sign-in that adds an account is told apart from a switch. */
export type AccountChangeReason = 'signIn' | 'switch' | 'signOut' | 'refresh' | 'endpoint'

export type AccountContext = Readonly<{
  /** Counts changes, so work started under one context can tell it is stale. */
  epoch: number
  api: string
  token: string | null
}>

export type AccountListener = (
  next: AccountContext,
  prev: AccountContext,
  reason: AccountChangeReason,
) => void

/** A user on a backend: the same user id on another backend is another account. */
export function accountOf(ctx: Pick<AccountContext, 'api' | 'token'>): string | null {
  return ctx.token ? `${unverifiedTokenSubject(ctx.token) ?? ''}@${ctx.api}` : null
}

export class AccountContexts {
  private ctx: AccountContext
  private readonly listeners = new Set<AccountListener>()
  private readonly leaving = new Set<() => void>()
  private readonly apply?: (api: string) => void

  /** `apply` projects the backend wherever else it has to be (e.g. for spawned helpers). */
  constructor(api: string, apply?: (api: string) => void) {
    this.apply = apply
    this.ctx = Object.freeze({ epoch: 0, api, token: null })
    apply?.(api)
  }

  current(): AccountContext {
    return this.ctx
  }

  /** Whether `ctx` is still the current context: nothing changed since it was taken. */
  isCurrent(ctx: AccountContext): boolean {
    return ctx === this.ctx
  }

  /**
   * Replaces the backend and token together. A token only ever takes effect
   * on the backend that issued it, so moving the current token to another
   * backend is refused; sign in there, or sign out first.
   */
  swap(next: { api: string; token: string | null }, reason: AccountChangeReason): AccountContext {
    const prev = this.ctx

    if (next.api === prev.api && next.token === prev.token) return prev
    if (next.token !== null && next.token === prev.token && next.api !== prev.api)
      throw new Error('A session token cannot move to another backend')
    this.ctx = Object.freeze({ epoch: prev.epoch + 1, api: next.api, token: next.token })
    if (next.api !== prev.api) this.apply?.(next.api)
    const left = accountOf(prev)

    // Whatever belongs to the account being left ends before anyone hears of the next one.
    if (left !== null && left !== accountOf(this.ctx))
      for (const dispose of this.leaving) {
        try {
          dispose()
        } catch (e) {
          console.warn('account: failed to end work of the previous account', e)
        }
      }
    for (const listener of this.listeners) listener(this.ctx, prev, reason)

    return this.ctx
  }

  subscribe(listener: AccountListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Registers work that belongs to the current account, ended whenever the app leaves an account. */
  onLeave(dispose: () => void): () => void {
    this.leaving.add(dispose)

    return () => {
      this.leaving.delete(dispose)
    }
  }
}
