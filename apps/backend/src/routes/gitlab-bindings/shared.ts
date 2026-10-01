import { GitlabApiError, GitlabOAuthNotConfigured } from '@/lib/byos/gitlab'
import { AppError } from '@/lib/errors'

import type { GitlabBinding } from '@/models'

export function publicView(b: GitlabBinding) {
  return {
    id: b.id.toHexString(),
    hostUrl: b.hostUrl,
    accountId: b.accountId,
    username: b.username,
    displayName: b.displayName,
    avatarUrl: b.avatarUrl,
    clientId: b.clientId,
    isDefaultClient: b.encryptedClientSecret === null,
    scope: b.scope,
    accessTokenExpiresAt: b.accessTokenExpiresAt?.toISOString() ?? null,
    createdAt: b.createdAt,
  }
}

export function handleGitlabError(e: unknown, fallbackMsg: string): never {
  if (e instanceof GitlabOAuthNotConfigured) {
    throw new AppError(503, 'gitlab_oauth_not_configured', e.message)
  }
  if (e instanceof GitlabApiError) {
    if (e.status === 401) {
      throw new AppError(
        401,
        'gitlab_unauthorized',
        'GitLab rejected the stored access token. Re-bind the account.',
      )
    }
    if (e.status === 404) {
      throw new AppError(404, 'gitlab_not_found', e.message)
    }
    throw new AppError(502, 'gitlab_api_error', e.message)
  }
  throw new AppError(500, 'gitlab_unknown_error', `${fallbackMsg}: ${(e as Error).message}`)
}
