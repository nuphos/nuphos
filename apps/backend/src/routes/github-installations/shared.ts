import { GithubApiError, GithubAppNotConfigured } from '@/lib/byos/github'
import { AppError } from '@/lib/errors'

import type { GithubInstallationBinding } from '@/models'

export function publicView(b: GithubInstallationBinding) {
  return {
    id: b.id.toHexString(),
    installationId: b.installationId,
    accountLogin: b.accountLogin,
    accountType: b.accountType,
    accountId: b.accountId,
    targetType: b.targetType,
    createdAt: b.createdAt,
  }
}

export function handleGithubError(e: unknown, fallbackMsg: string): never {
  if (e instanceof GithubAppNotConfigured) {
    throw new AppError(503, 'github_app_not_configured', e.message)
  }
  if (e instanceof GithubApiError) {
    if (e.status === 404) {
      throw new AppError(
        404,
        'github_installation_not_found',
        'GitHub App cannot access this installation. Ensure the App is installed.',
      )
    }
    throw new AppError(502, 'github_api_error', e.message)
  }
  throw new AppError(500, 'github_unknown_error', `${fallbackMsg}: ${(e as Error).message}`)
}
