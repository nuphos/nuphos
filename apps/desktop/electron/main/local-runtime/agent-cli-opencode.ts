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

/**
 * The credentials `auth list` names, as OpenCode 2.x's `auth logout` takes them: each
 * integration's connections of the credential kind. Anything it cannot read names none.
 */
export function openCodeCredentials(output: string): { integration: string; credential: string }[] {
  try {
    const integrations: unknown = JSON.parse(output)

    if (!Array.isArray(integrations)) return []

    return (integrations as { id?: unknown; connections?: unknown }[]).flatMap(
      ({ id, connections }) =>
        typeof id === 'string' && Array.isArray(connections)
          ? (connections as { type?: unknown; id?: unknown }[]).flatMap((connection) =>
              connection.type === 'credential' && typeof connection.id === 'string'
                ? [{ integration: id, credential: connection.id }]
                : [],
            )
          : [],
    )
  } catch {
    return []
  }
}

/** Removes one credential through a private server; off a terminal it must be named. */
export const openCodeLogout = (integration: string, credential: string) => [
  'auth',
  'logout',
  integration,
  credential,
  '--standalone',
]
