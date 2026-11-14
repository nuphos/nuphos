/** A private server, so the owner's own OpenCode background service is neither used nor started. */
export const OPENCODE_AUTH_LIST = ['auth', 'list', '--standalone', '--format', 'json']

/** OpenCode 2.x keeps credentials in its database; `auth list` names each integration's connections. */
export function parseOpenCodeAuthList(output: string): {
  loggedIn: boolean
  account?: string
  credentialsUnread?: true
} {
  try {
    const integrations: unknown = JSON.parse(output)

    if (!Array.isArray(integrations)) return { loggedIn: false, credentialsUnread: true }
    const connected = (integrations as { name?: unknown; connections?: unknown[] }[]).find(
      (integration) => integration.connections?.length,
    )

    if (!connected) return { loggedIn: false }

    return {
      loggedIn: true,
      ...(typeof connected.name === 'string' ? { account: connected.name } : {}),
    }
  } catch {
    // A 1.x CLI rejects the flags; its login is the auth.json checked before this.
    return { loggedIn: false, credentialsUnread: true }
  }
}
