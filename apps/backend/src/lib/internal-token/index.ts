// Internal tokens (conversation tokens today) are ES256 JWTs from a dedicated
// issuer. That issuer and its JWKS are kept apart from the cloud federation
// issuer (`lib/byos/aws-oidc.ts`): clouds accept a token signed by any key in a
// trusted issuer's JWKS, so publishing this frequently used key there would let
// it sign tokens that customer trust policies accept. No cloud relying party is
// ever configured to trust this issuer.
import { createPublicKey, verify } from 'node:crypto'

import { config } from '@/config'

import {
  assertP256,
  awsKmsSigner,
  gcpKmsSigner,
  googleKmsCall,
  keyIdOf,
  localSigner,
} from './signer'

import type { InternalTokenSigner } from './signer'
import type { KeyObject } from 'node:crypto'

type ActiveSigner = { kid: string; signer: InternalTokenSigner }

let active: ActiveSigner | null = null
let verifyKeys = new Map<string, KeyObject>()
let initialized: Promise<void> | null = null

export function internalTokenIssuer(): string {
  return config.auth.internalTokens.issuer ?? `${config.auth.publicBaseUrl}/internal`
}

function configuredSigner(): InternalTokenSigner | null {
  const { kmsKeyId, kmsRegion, gcpKmsKeyVersion, privateKeyBase64 } = config.auth.internalTokens

  if (kmsKeyId && gcpKmsKeyVersion) {
    throw new Error('Set only one of NUPHOS_INTERNAL_TOKEN_KMS_KEY_ID and _GCP_KMS_KEY_VERSION')
  }
  if (kmsKeyId) return awsKmsSigner(kmsKeyId, kmsRegion)
  if (gcpKmsKeyVersion) return gcpKmsSigner(gcpKmsKeyVersion, googleKmsCall())
  if (privateKeyBase64) return localSigner(Buffer.from(privateKeyBase64, 'base64').toString('utf8'))

  return null
}

function previousPublicKeys(): KeyObject[] {
  return config.auth.internalTokens.previousPublicKeysBase64.map((b64) => {
    const key = createPublicKey(Buffer.from(b64, 'base64').toString('utf8'))

    assertP256(key, 'NUPHOS_INTERNAL_TOKEN_PREVIOUS_PUBLIC_KEYS_BASE64')

    return key
  })
}

async function load(signer: InternalTokenSigner | null): Promise<void> {
  const keys = new Map<string, KeyObject>()

  for (const key of previousPublicKeys()) keys.set(keyIdOf(key), key)
  let next: ActiveSigner | null = null

  if (signer) {
    const publicKey = await signer.publicKey()
    const kid = keyIdOf(publicKey)

    keys.set(kid, publicKey)
    next = { kid, signer }
  }
  verifyKeys = keys
  active = next
}

/**
 * Loads the signer's public key before the backend serves requests, so every
 * replica can verify ES256 tokens synchronously. Without a configured signer,
 * conversation tokens stay HS256.
 */
export function initInternalTokens(): Promise<void> {
  initialized ??= load(configuredSigner()).catch((error: unknown) => {
    initialized = null
    throw error
  })

  return initialized
}

/** Test hook: swap the signer without touching config. */
export async function setInternalTokenSignerForTest(signer: InternalTokenSigner | null) {
  initialized = load(signer)
  await initialized
}

export async function internalTokensEnabled(): Promise<boolean> {
  await initInternalTokens()

  return active !== null
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

/** Signs `claims` as an ES256 JWT with the active key, or returns null when no signer is configured. */
export async function signInternalToken(claims: object): Promise<string | null> {
  await initInternalTokens()
  if (!active) return null
  const { kid, signer } = active
  const signingInput = `${b64urlJson({ alg: 'ES256', typ: 'JWT', kid })}.${b64urlJson(claims)}`
  const signature = await signer.sign(signingInput)

  return `${signingInput}.${signature.toString('base64url')}`
}

/**
 * The payload of an ES256 token from the internal issuer, before any claim
 * checks: the `kid` must be in the internal JWKS and `iss` must be the internal
 * issuer. Null for every other token.
 */
export function verifiedInternalPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')

  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
      alg?: unknown
      kid?: unknown
    }

    if (header.alg !== 'ES256' || typeof header.kid !== 'string') return null
    const key = verifyKeys.get(header.kid)

    if (!key) return null
    const valid = verify(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(parts[2], 'base64url'),
    )

    if (!valid) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown

    if (!payload || typeof payload !== 'object') return null
    if ((payload as { iss?: unknown }).iss !== internalTokenIssuer()) return null

    return payload as Record<string, unknown>
  } catch {
    return null
  }
}

/** Public JWKS of the internal issuer: the active key plus keys kept for a rotation. */
export function internalJwks(): { keys: Record<string, string>[] } {
  return {
    keys: [...verifyKeys].map(([kid, key]) => {
      const jwk = key.export({ format: 'jwk' }) as {
        kty: string
        crv: string
        x: string
        y: string
      }

      return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid, alg: 'ES256', use: 'sig' }
    }),
  }
}
