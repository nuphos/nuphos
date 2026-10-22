import {
  blockedUrlReason,
  OutboundBlockedError,
  pinnedRequest,
  resolvePublicTarget,
} from '@/lib/net/safe-outbound'

import type { HostLookup, PinnedRequestInput, ResolvedTarget } from '@/lib/net/safe-outbound'

export class SonarqubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly responseBody?: unknown,
  ) {
    super(message)
    this.name = 'SonarqubeApiError'
  }
}

export type SonarqubeResolvedTarget = ResolvedTarget
export type { PinnedRequestInput }

export const blockedSonarqubeBaseUrlReason = blockedUrlReason
export const pinnedNodeRequest = pinnedRequest

/** Resolve and classify the host immediately before each credential-bearing request. */
export async function resolvePublicSonarqubeTarget(
  baseUrl: string,
  lookup?: HostLookup,
): Promise<SonarqubeResolvedTarget> {
  try {
    return await resolvePublicTarget(baseUrl, lookup)
  } catch (error) {
    if (!(error instanceof OutboundBlockedError)) throw error
    throw new SonarqubeApiError(`SonarQube ${error.message}`, error.status === 400 ? 400 : 0, '/')
  }
}
