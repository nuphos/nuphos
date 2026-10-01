// Linear is a single hosted instance; there is no self-hosted variant and no
// per-binding OAuth client override (unlike GitLab). All requests go here.
// Access tokens live ~24h and refresh tokens rotate on every exchange, so the
// credential handout refreshes ~60s ahead of expiry (mirrors Jira).
export const LINEAR_AUTHORIZE_URL = 'https://linear.app/oauth/authorize'
export const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token'
export const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql'
export const USER_AGENT = 'nuphos-backend'
const LINEAR_FETCH_TIMEOUT_MS = 30_000

export class LinearApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export class LinearOAuthNotConfigured extends Error {
  constructor() {
    super('Linear OAuth is not configured (set LINEAR_OAUTH_CLIENT_ID/SECRET)')
  }
}

export async function linearFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(LINEAR_FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as { name?: string }).name

    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new LinearApiError(
        504,
        `Linear request timed out after ${String(LINEAR_FETCH_TIMEOUT_MS)}ms`,
      )
    }
    const message = e instanceof Error ? e.message : 'unknown transport error'

    throw new LinearApiError(502, `Linear request failed: ${message}`)
  }
}
