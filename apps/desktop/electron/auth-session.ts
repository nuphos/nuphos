// The main process's view of which session token is currently authenticated.
// Every auth transition (login, logout, a probe that finds the token rejected)
// lands here, so anything bound to "the signed-in user" subscribes once instead
// of hooking each individual login/logout path.

export type AuthSessionListener = (next: string | null, prev: string | null) => void

export class AuthSession {
  private token: string | null = null
  private readonly listeners = new Set<AuthSessionListener>()

  current(): string | null {
    return this.token
  }

  set(token: string | null): void {
    if (token === this.token) return
    const prev = this.token

    this.token = token
    for (const listener of this.listeners) listener(token, prev)
  }

  subscribe(listener: AuthSessionListener): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const authSession = new AuthSession()
