import { SonarqubeApiError } from '@/lib/byos/sonarqube'
import { AppError } from '@/lib/errors'

import type { SonarqubeIntegrationBinding } from '@/models'

export function sonarqubePublicView(binding: SonarqubeIntegrationBinding) {
  return {
    id: binding.id.toHexString(),
    label: binding.label,
    baseUrl: binding.baseUrl,
    version: binding.version,
    createdAt: binding.createdAt,
  }
}

export function mapSonarqubeError(err: unknown): AppError {
  if (err instanceof SonarqubeApiError) {
    if (err.status === 400) {
      return new AppError(400, 'sonarqube_host_not_allowed', err.message)
    }
    if (err.status === 401 || err.status === 403) {
      return new AppError(
        400,
        'invalid_sonarqube_credentials',
        'The SonarQube token is invalid, revoked, or lacks the required project permission.',
      )
    }
    if (err.status === 0) {
      return new AppError(502, 'sonarqube_unreachable', err.message)
    }

    return new AppError(502, 'sonarqube_api_error', `SonarQube ${err.path} failed: ${err.message}`)
  }

  return new AppError(502, 'sonarqube_api_error', err instanceof Error ? err.message : String(err))
}
