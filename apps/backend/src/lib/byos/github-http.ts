export const GITHUB_API = 'https://api.github.com'
export const USER_AGENT = 'nuphos-backend'
const GITHUB_FETCH_TIMEOUT_MS = 30_000

export class GithubApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function githubFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as { name?: string }).name

    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new GithubApiError(
        504,
        `GitHub request timed out after ${String(GITHUB_FETCH_TIMEOUT_MS)}ms`,
      )
    }
    const message = e instanceof Error ? e.message : 'unknown transport error'

    throw new GithubApiError(502, `GitHub request failed: ${message}`)
  }
}

// Only plain-object headers: the helpers merge them by spreading, which
// silently drops a `Headers` instance or an entry-pair array.
export type GithubRequestInit = Omit<RequestInit, 'headers'> & { headers?: Record<string, string> }
