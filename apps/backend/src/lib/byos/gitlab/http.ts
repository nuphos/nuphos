import { blockedUrlReason, OutboundBlockedError, pinnedFetch } from '@/lib/net/safe-outbound'

export const USER_AGENT = 'nuphos-backend'
export const GITLAB_FETCH_TIMEOUT_MS = 30_000

export class GitlabApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export class GitlabOAuthNotConfigured extends Error {
  constructor() {
    super('GitLab OAuth defaults are not configured (set GITLAB_OAUTH_CLIENT_ID/SECRET)')
  }
}

export async function gitlabFetch(url: string, init: RequestInit): Promise<Response> {
  const { body } = init

  if (body != null && typeof body !== 'string' && !(body instanceof URLSearchParams)) {
    throw new GitlabApiError(500, 'GitLab request body must be a string or URLSearchParams')
  }
  try {
    return await pinnedFetch(url, {
      method: init.method,
      headers: init.headers,
      body: body == null ? undefined : String(body),
      signal: init.signal ?? AbortSignal.timeout(GITLAB_FETCH_TIMEOUT_MS),
    })
  } catch (e) {
    if (e instanceof OutboundBlockedError) {
      throw new GitlabApiError(e.status, `GitLab host refused: ${e.message}`)
    }
    const name = (e as { name?: string }).name

    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new GitlabApiError(
        504,
        `GitLab request timed out after ${String(GITLAB_FETCH_TIMEOUT_MS)}ms`,
      )
    }
    const message = e instanceof Error ? e.message : 'unknown transport error'

    throw new GitlabApiError(502, `GitLab request failed: ${message}`)
  }
}

export function normalizeHostUrl(input: string): string {
  let url: URL

  try {
    url = new URL(input)
  } catch {
    throw new GitlabApiError(400, `Invalid GitLab host URL: ${input}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new GitlabApiError(400, `GitLab host URL must use http or https (got ${url.protocol})`)
  }
  const reason = blockedUrlReason(url.origin)

  if (reason) throw new GitlabApiError(400, `GitLab host URL refused: ${reason}`)

  // Strip trailing slashes + the path; we only want origin.
  return url.origin
}

export function isDefaultHost(hostUrl: string): boolean {
  return normalizeHostUrl(hostUrl) === 'https://gitlab.com'
}
