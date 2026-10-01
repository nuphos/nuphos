import { createHash, createPublicKey, createSign, randomUUID } from 'node:crypto'

import { config } from '@/config'

import type { KeyObject } from 'node:crypto'

/**
 * Nuphos as an OIDC identity provider for AWS web-identity federation.
 *
 * Customers register `https://<issuer>` as an IAM OIDC identity provider and
 * trust it in their role's policy with `sts:AssumeRoleWithWebIdentity`,
 * conditioned on `<issuer-host>:sub` = `nuphos:team:<teamId>`. The backend
 * mints a short-lived RS256 ID token per team and exchanges it at STS — no
 * long-lived AWS credentials involved, and AWS itself enforces that a token
 * minted for team A can never assume team B's role (the confused-deputy
 * mitigation that ExternalId only approximates).
 *
 * AWS validates tokens against the JWKS served at
 * `<issuer>/.well-known/jwks.json` (see routes/well-known.ts), so the issuer
 * URL must be publicly reachable over HTTPS.
 */

type KeyMaterial = {
  privateKeyPem: string
  kid: string
  publicJwk: { kty: string; n: string; e: string }
}

let cachedKey: { source: string; material: KeyMaterial } | null = null

function loadPrivateKeyPem(): string | null {
  const { privateKey, privateKeyBase64 } = config.byos.aws.oidc

  if (privateKey) return privateKey
  if (privateKeyBase64) return Buffer.from(privateKeyBase64, 'base64').toString('utf-8')

  return null
}

export function isAwsOidcConfigured(): boolean {
  return loadPrivateKeyPem() !== null
}

function publicJwkOf(publicKey: KeyObject): { kid: string; jwk: KeyMaterial['publicJwk'] } {
  const jwk = publicKey.export({ format: 'jwk' }) as { kty?: string; n?: string; e?: string }

  if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) {
    throw new Error('AWS BYOS OIDC keys must be RSA keys (RS256)')
  }
  // Stable key id derived from the public key, so rotation produces a new kid
  // without any extra configuration.
  const der = publicKey.export({ type: 'spki', format: 'der' })
  const kid = createHash('sha256').update(der).digest('base64url').slice(0, 16)

  return { kid, jwk: { kty: jwk.kty, n: jwk.n, e: jwk.e } }
}

function getKeyMaterial(): KeyMaterial {
  const pem = loadPrivateKeyPem()

  if (!pem) {
    throw new Error(
      'AWS BYOS OIDC signing key not configured (set AWS_BYOS_OIDC_PRIVATE_KEY or AWS_BYOS_OIDC_PRIVATE_KEY_BASE64)',
    )
  }
  if (cachedKey && cachedKey.source === pem) return cachedKey.material

  const { kid, jwk } = publicJwkOf(createPublicKey(pem))
  const material: KeyMaterial = { privateKeyPem: pem, kid, publicJwk: jwk }

  cachedKey = { source: pem, material }

  return material
}

/**
 * Extra public keys served in the JWKS alongside the active signing key —
 * the rotation overlap window. Rotation procedure: (1) publish the NEXT
 * public key here and deploy; (2) once AWS's JWKS cache has refreshed, swap
 * the signing key and move the OLD public key here; (3) after all tokens
 * minted with the old key have expired (tokenTtlSec + JWKS cache max-age),
 * drop it.
 */
function getAdditionalPublicJwks(): { kid: string; jwk: KeyMaterial['publicJwk'] }[] {
  return config.byos.aws.oidc.additionalPublicKeysBase64.map((b64) => {
    const pem = Buffer.from(b64, 'base64').toString('utf-8')

    return publicJwkOf(createPublicKey(pem))
  })
}

/**
 * Fail fast on malformed key material. Called at boot so a bad OIDC secret
 * crashes the deploy instead of surfacing as request-time 500s (or as
 * `isAwsOidcConfigured()` advertising a connector that cannot sign).
 */
export function validateAwsOidcConfig(): void {
  if (!isAwsOidcConfigured()) return
  getKeyMaterial()
  getAdditionalPublicJwks()
}

/** Public HTTPS origin AWS uses as both `iss` and the IAM provider URL. */
export function getAwsOidcIssuer(): string {
  const issuer = config.byos.aws.oidc.issuer ?? config.auth.publicBaseUrl

  return issuer.replace(/\/$/, '')
}

/**
 * The `sub` claim for a team's tokens. Customers pin this in their role trust
 * policy: `"<issuer-host>:sub": "nuphos:team:<teamId>"`.
 */
export function awsOidcSubjectForTeam(teamId: string): string {
  return `nuphos:team:${teamId}`
}

/**
 * Mint a short-lived RS256 ID token for this team against an arbitrary
 * audience, signed by the shared Nuphos issuer key. AWS web-identity and
 * Volcengine OIDC are the same Nuphos IdP (same issuer, JWKS, `sub`); only the
 * `aud` — the client id the customer registers on their OIDC provider —
 * differs. Exported so non-AWS consumers (e.g. Volcengine STS) can reuse it.
 */
export function mintNuphosOidcToken(
  teamId: string,
  audience: string,
  ttlSec: number = config.byos.aws.oidc.tokenTtlSec,
): string {
  const { privateKeyPem, kid } = getKeyMaterial()
  const nowSec = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString(
    'base64url',
  )
  const payload = Buffer.from(
    JSON.stringify({
      iss: getAwsOidcIssuer(),
      sub: awsOidcSubjectForTeam(teamId),
      aud: audience,
      iat: nowSec,
      exp: nowSec + ttlSec,
      jti: randomUUID(),
    }),
  ).toString('base64url')
  const signingInput = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')

  signer.update(signingInput)
  const signature = signer.sign(privateKeyPem).toString('base64url')

  return `${signingInput}.${signature}`
}

/** Mint a short-lived RS256 ID token for sts:AssumeRoleWithWebIdentity. */
export function mintAwsWebIdentityToken(teamId: string): string {
  return mintNuphosOidcToken(teamId, config.byos.aws.oidc.audience)
}

/** Discovery document with the fields AWS requires of an OIDC provider. */
export function getAwsOidcDiscovery(): Record<string, unknown> {
  const issuer = getAwsOidcIssuer()

  return {
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ['id_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    claims_supported: ['aud', 'exp', 'iat', 'iss', 'jti', 'sub'],
  }
}

export function getAwsOidcJwks(): Record<string, unknown> {
  const active = getKeyMaterial()
  const entries = [{ kid: active.kid, jwk: active.publicJwk }, ...getAdditionalPublicJwks()]
  const seen = new Set<string>()
  const keys = entries
    .filter(({ kid }) => !seen.has(kid) && (seen.add(kid), true))
    .map(({ kid, jwk }) => ({ ...jwk, kid, alg: 'RS256', use: 'sig' }))

  return { keys }
}
