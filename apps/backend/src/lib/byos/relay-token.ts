import { createHmac } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

/**
 * Tokens for the on-prem cluster relay (`apps/kube-relay`). The relay verifies
 * them with the same shared secret and nothing else — no database, no callback
 * to us — so everything it needs to authorise a connection is in here.
 *
 *   nr1_<base64url(payload)>.<base64url(hmac-sha256(payload))>
 *
 * The wire format is a contract with `apps/kube-relay/token.go`: field order and
 * the omission of an empty `s` are part of it, because both sides sign the exact
 * payload bytes. relay-token.test.ts pins the same vector as the Go test.
 */
export type RelayTokenPurpose = 'agent' | 'session'

export type RelayTokenClaims = {
  /** Opaque per-cluster id. Never a team id: a leaked token should say nothing. */
  k: string
  p: RelayTokenPurpose
  exp: number
  s?: string
}

const TOKEN_PREFIX = 'nr1_'

/** Kept out of the token namespace so a status header cannot be replayed as one. */
const STATUS_CREDENTIAL_LABEL = 'nuphos-relay-status-v1'

const AGENT_TOKEN_TTL_DAYS = 365
/**
 * Session tokens only have to outlive one agent session's kubeconfig. Long
 * enough that a slow investigation does not lose its cluster mid-run, short
 * enough that one leaking out of a sandbox is not a standing key.
 */
const SESSION_TOKEN_TTL_HOURS = 12

function base64url(value: Buffer): string {
  return value.toString('base64url')
}

export function signRelayToken(secret: string, claims: RelayTokenClaims): string {
  // Key order is load-bearing (see the note above): k, p, exp, then s.
  const ordered: RelayTokenClaims = { k: claims.k, p: claims.p, exp: claims.exp }

  if (claims.s) ordered.s = claims.s
  const payload = base64url(Buffer.from(JSON.stringify(ordered), 'utf8'))
  const mac = createHmac('sha256', secret).update(payload).digest()

  return `${TOKEN_PREFIX}${payload}.${base64url(mac)}`
}

/**
 * The credential the relay's /status endpoint accepts. Derived rather than being
 * the signing secret itself: that listener is plain HTTP, so a captured header
 * should be a read-only status credential, not the key that mints agent and
 * session tokens for every enrolled cluster. Must match statusCredential in
 * apps/kube-relay/token.go.
 */
export function relayStatusCredential(): string {
  return deriveRelayStatusCredential(relaySecret())
}

/** Pure form, so the cross-language vector can be pinned without ambient config. */
export function deriveRelayStatusCredential(secret: string): string {
  return createHmac('sha256', secret).update(STATUS_CREDENTIAL_LABEL).digest('hex')
}

export function relayConfigured(): boolean {
  const { tokenSecret, agentEndpoint, proxyEndpoint, agentImage } = config.relay

  // agentImage counts: without one there is no manifest to hand a customer, and
  // defaulting it would mean shipping a mutable tag into their cluster.
  return Boolean(tokenSecret && agentEndpoint && proxyEndpoint && agentImage)
}

function relaySecret(): string {
  const secret = config.relay.tokenSecret

  if (!secret) {
    throw new AppError(
      503,
      'relay_not_configured',
      'On-prem cluster relay is not configured on this deployment (NUPHOS_RELAY_TOKEN_SECRET).',
    )
  }

  return secret
}

/**
 * The long-lived token that lives in a Secret in the customer's cluster. It is
 * shown once, at enrolment, and re-issued by rotating rather than by reading it
 * back — we keep no copy.
 */
export function mintRelayAgentToken(clusterKey: string, now = new Date()): string {
  return signRelayToken(relaySecret(), {
    k: clusterKey,
    p: 'agent',
    exp: Math.floor(now.getTime() / 1000) + AGENT_TOKEN_TTL_DAYS * 24 * 60 * 60,
  })
}

export function mintRelaySessionToken(
  clusterKey: string,
  sessionId: string,
  now = new Date(),
): string {
  return signRelayToken(relaySecret(), {
    k: clusterKey,
    p: 'session',
    exp: Math.floor(now.getTime() / 1000) + SESSION_TOKEN_TTL_HOURS * 60 * 60,
    s: sessionId,
  })
}

/**
 * The `proxy-url` for a kubeconfig cluster entry. The token rides as the Basic
 * username because that is what Go's HTTP transport turns a proxy URL's userinfo
 * into — so kubectl authenticates to the relay with no client-side glue, and the
 * TLS session underneath stays end-to-end with the customer's API server.
 */
export function relayProxyUrl(clusterKey: string, sessionId: string, now = new Date()): string {
  const token = mintRelaySessionToken(clusterKey, sessionId, now)
  const endpoint = config.relay.proxyEndpoint

  if (!endpoint) {
    throw new AppError(
      503,
      'relay_not_configured',
      'On-prem cluster relay is not configured on this deployment (NUPHOS_RELAY_PROXY_ENDPOINT).',
    )
  }
  // Bare host:port means https, which is the only thing a real deployment
  // should use. A scheme may be given explicitly so local development can point
  // at a plaintext relay without a second env var to keep in step.
  const [scheme, hostPort] = endpoint.includes('://')
    ? [endpoint.slice(0, endpoint.indexOf('://')), endpoint.slice(endpoint.indexOf('://') + 3)]
    : ['https', endpoint]

  return `${scheme}://${encodeURIComponent(token)}:x@${hostPort}`
}
