// The main process's one view of who is signed in, and on which backend.
// Every auth transition (login, logout, a probe that finds the token rejected,
// a new endpoint) replaces the context here, so anything bound to "the
// signed-in account" subscribes once instead of hooking each path.
//
// A context never changes once made. Work takes one with `context()` and uses
// its backend, token and signal together: a sign-out or another account aborts
// the signal, so nothing that started as one account can finish as another.

export type AccountContext = {
  /** Grows with every change. */
  readonly epoch: number
  /** The backend's origin. */
  readonly api: string
  readonly token: string | null
  /** The signed-in user's id. Tokens are opaque, so it is kept beside them. */
  readonly userId: string | null
  /** Aborts when this session's token stops being the signed-in one. */
  readonly signal: AbortSignal
}

export type AuthSessionListener = (next: AccountContext, prev: AccountContext) => void

/** Work that began as one account and would have finished as another. */
export class AccountChangedError extends Error {
  constructor() {
    super('The account changed. Try again.')
    this.name = 'AccountChangedError'
  }
}

export class AuthSession {
  private ctx: AccountContext
  private known = false
  private controller = new AbortController()
  private readonly listeners = new Set<AuthSessionListener>()

  constructor(api = 'https://api.nuphos.ai') {
    this.ctx = { epoch: 0, api, token: null, userId: null, signal: this.controller.signal }
  }

  context(): AccountContext {
    return this.ctx
  }

  /** Whether anything has set the session yet; until then the token is still on disk. */
  settled(): boolean {
    return this.known
  }

  /** The backend the app was launched with; ignored once anything has used the session. */
  start(api: string): void {
    if (this.known) {
      console.warn('auth: the session started before its backend was set; keeping', this.ctx.api)

      return
    }
    this.ctx = { ...this.ctx, api }
  }

  current(): string | null {
    return this.ctx.token
  }

  userId(): string | null {
    return this.ctx.userId
  }

  // Token and user always change together: tokens are opaque, so a caller
  // that left the user out would silently forget who is signed in.
  set(token: string | null, userId: string | null): void {
    this.replace(this.ctx.api, token, token ? userId : null)
  }

  /**
   * Points the app at another backend. A token belongs to the backend that
   * issued it, so the session ends there: it is never sent to the new one.
   */
  moveTo(api: string): void {
    if (api !== this.ctx.api) this.replace(api, null, null)
  }

  subscribe(listener: AuthSessionListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  private replace(api: string, token: string | null, userId: string | null): void {
    const prev = this.ctx
    const same = api === prev.api && token === prev.token && userId === prev.userId
    // Work holds the previous context's token or, before the startup check,
    // the one on disk. Signing in keeps the signal for what read that same
    // token from disk; a sign-out, even before the check, ends it.
    const unchecked = !this.known && token === null
    const ends = same ? unchecked : prev.token !== null || unchecked

    this.known = true
    if (ends) this.end()
    if (same) return
    this.ctx = { epoch: prev.epoch + 1, api, token, userId, signal: this.controller.signal }
    for (const listener of this.listeners) listener(this.ctx, prev)
  }

  private end(): void {
    const ended = this.controller

    this.controller = new AbortController()
    this.ctx = { ...this.ctx, signal: this.controller.signal }
    ended.abort(new AccountChangedError())
  }
}

// api-endpoint.ts points it at the configured backend as it loads.
export const authSession = new AuthSession()
