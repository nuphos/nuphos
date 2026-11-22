/** A private server, so the owner's own OpenCode background service is neither used nor started. */
export const OPENCODE_AUTH_LIST = ['auth', 'list', '--standalone', '--format', 'json']

/**
 * OpenCode answers on OpenCode Zen's free models with no provider connected, so it is always
 * signed in. OpenCode 2.x's `auth list` names the first connected integration as the account;
 * 1.x rejects the flags and names none.
 */
export function parseOpenCodeAuthList(output: string): { loggedIn: true; account?: string } {
  try {
    const integrations: unknown = JSON.parse(output)
    const connected = Array.isArray(integrations)
      ? (integrations as { name?: unknown; connections?: unknown[] }[]).find(
          (integration) => integration.connections?.length,
        )
      : undefined

    if (typeof connected?.name === 'string') return { loggedIn: true, account: connected.name }
  } catch {
    // A 1.x CLI, which prints its help instead.
  }

  return { loggedIn: true }
}

/** Whether `auth list` names a connected provider; undefined when it cannot be read, as from 1.x. */
export function openCodeConnected(output: string): boolean | undefined {
  try {
    const integrations: unknown = JSON.parse(output)

    if (Array.isArray(integrations))
      return (integrations as { connections?: unknown[] }[]).some((integration) =>
        Boolean(integration.connections?.length),
      )
  } catch {
    // A 1.x CLI, which prints its help instead.
  }

  return undefined
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
