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
