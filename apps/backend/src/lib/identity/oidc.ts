import { createRemoteJWKSet, jwtVerify } from 'jose'

import { AppError } from '@/lib/errors'

import type { JWTPayload } from 'jose'

export type Endpoints = { authorize: string; token: string; keys: string; issuer: string[] }

let oidcDiscovery: { issuer: string; until: number; endpoints: Endpoints } | undefined
const oidcKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export async function discoverOidc(issuer: string): Promise<Endpoints> {
  if (oidcDiscovery?.issuer === issuer && oidcDiscovery.until > Date.now())
    return oidcDiscovery.endpoints
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(10_000),
  })
  const doc = (await response.json().catch(() => null)) as Record<string, unknown> | null

  if (
    !response.ok ||
    doc?.issuer !== issuer ||
    typeof doc.authorization_endpoint !== 'string' ||
    typeof doc.token_endpoint !== 'string' ||
    typeof doc.jwks_uri !== 'string'
  )
    throw new AppError(503, 'provider_unavailable', 'OIDC provider discovery failed')
  const found = {
    authorize: doc.authorization_endpoint,
    token: doc.token_endpoint,
    keys: doc.jwks_uri,
    issuer: [issuer],
  }

  oidcDiscovery = { issuer, until: Date.now() + 3_600_000, endpoints: found }

  return found
}

export async function verifyOidcIdToken(token: string, jwksUri: string): Promise<JWTPayload> {
  let keys = oidcKeySets.get(jwksUri)

  if (!keys) {
    keys = createRemoteJWKSet(new URL(jwksUri))
    oidcKeySets.set(jwksUri, keys)
  }
  try {
    return (await jwtVerify(token, keys)).payload
  } catch {
    throw new AppError(401, 'invalid_identity', 'Invalid provider signature')
  }
}
