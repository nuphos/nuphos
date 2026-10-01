import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { getNuphosUserById, signNuphosToken } from '@/lib/identity'
import { generateOpaqueToken, hashToken, safeEqualStr, verifyPkceS256 } from '@/lib/oauth/tokens'

import type { NuphosUser } from '@/lib/identity'
import type { Collection } from 'mongodb'

/**
 * Native-app sign-in handoff (RFC 8252, "OAuth 2.0 for Native Apps").
 *
 * The app registers its loopback delivery target before the browser opens and
 * gets an opaque handle; the browser leg carries only that handle. When the
 * Google exchange completes we bind the user to the handle and mint a one-time
 * `deliveryCode` that rides the loopback redirect. The app exchanges
 * `handle + codeVerifier + deliveryCode` for the session over TLS.
 *
 * Two independent bindings, and BOTH are load-bearing — neither substitutes for
 * the other:
 *
 *   - the PKCE verifier proves the redeemer is the process that *registered*
 *     the handle;
 *   - the deliveryCode proves the redeemer is the machine that *received the
 *     loopback redirect*, i.e. the machine whose browser authenticated.
 *
 * Registration is unauthenticated by necessity (nobody has signed in yet), so
 * anyone can register a handle and hand a victim a link that binds the victim's
 * identity to it. PKCE does not help there — the attacker holds the verifier
 * for a challenge they chose. Only the deliveryCode does, because it is
 * delivered to the loopback listener on the browser's own machine and nowhere
 * else. Never make redemption succeed without it.
 *
 * Deviation from RFC 8252 worth naming: PKCE here binds the app to *our*
 * authorization endpoint, not to Google's. Google's client is confidential and
 * the code exchange happens server-side in `signInWithGoogleCode`, so a PKCE
 * challenge on that leg would add nothing. From the native app's point of view
 * this backend *is* the authorization server, and that is the leg PKCE protects.
 */

export type NativeAuthSession = {
  /** hashToken(handle) — the handle itself is never stored. */
  _id: string
  redirectUri: string
  codeChallenge: string
  /** Opaque correlation value the app hands back to its own listener. */
  clientState?: string
  status: 'pending' | 'ready'
  /** Set once the Google exchange completes and binds an identity. */
  userId?: string
  /** hashToken(deliveryCode) — the code itself is never stored. */
  deliveryCodeHash?: string
  createdAt: Date
  expiresAt: Date
}

export const nativeAuthSessions = (): Collection<NativeAuthSession> =>
  db().collection<NativeAuthSession>('native_auth_sessions')

// Long enough for a human to pick an account and clear an MFA prompt, short
// enough that an abandoned registration is not a lingering delivery target.
const SESSION_TTL_MS = 10 * 60 * 1000

export async function setupNativeAuthIndexes(): Promise<void> {
  await nativeAuthSessions().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: 'native_auth_sessions_ttl' },
  )
}

/** Where a completed (or failed) native sign-in should send the browser. */
export type NativeDeliveryTarget = {
  redirectUri: string
  clientState?: string
}

/**
 * RFC 8252 §7.3: a native app receives the redirect on a loopback interface
 * with a port chosen at runtime, so the port cannot be pinned. Everything else
 * is pinned as tightly as possible — including rejecting a pre-seeded query or
 * fragment, since we append our own parameters to this URL later and a caller
 * that could pre-set them could shadow ours.
 */
export function isLoopbackRedirectUri(raw: string): boolean {
  let url: URL

  try {
    url = new URL(raw)
  } catch {
    return false
  }

  if (url.protocol !== 'http:') return false
  // RFC 8252 prefers the IP literals; `localhost` is accepted because it is
  // what the shipped desktop app already binds and resolves to the same place.
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]' && url.hostname !== 'localhost')
    return false
  if (url.pathname !== '/callback') return false
  if (url.search !== '' || url.hash !== '') return false

  const port = Number(url.port)

  return Number.isInteger(port) && port >= 1024 && port <= 65535
}

const CLIENT_STATE_RE = /^[A-Za-z0-9_-]{1,128}$/

/** Unauthenticated by necessity — see the module comment for why that is safe. */
export async function registerNativeSession(input: {
  redirectUri: unknown
  codeChallenge: unknown
  codeChallengeMethod: unknown
  clientState?: unknown
}): Promise<{ handle: string; expiresInSec: number }> {
  const { redirectUri, codeChallenge, codeChallengeMethod, clientState } = input

  if (typeof redirectUri !== 'string' || !isLoopbackRedirectUri(redirectUri)) {
    throw new AppError(
      400,
      'invalid_redirect_uri',
      'redirectUri must be an http loopback /callback URL with an explicit port',
    )
  }
  if (codeChallengeMethod !== 'S256') {
    throw new AppError(400, 'invalid_challenge_method', 'code_challenge_method must be S256')
  }
  // The same shape verifyPkceS256 will demand later; rejecting it now means a
  // client cannot register a challenge it could never satisfy.
  if (typeof codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    throw new AppError(
      400,
      'invalid_code_challenge',
      'codeChallenge must be a base64url-encoded SHA-256 digest',
    )
  }
  if (
    clientState !== undefined &&
    (typeof clientState !== 'string' || !CLIENT_STATE_RE.test(clientState))
  ) {
    throw new AppError(400, 'invalid_client_state', 'clientState must be a short opaque token')
  }

  const handle = generateOpaqueToken()
  const now = new Date()

  await nativeAuthSessions().insertOne({
    _id: hashToken(handle),
    redirectUri,
    codeChallenge,
    clientState,
    status: 'pending',
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  })

  return { handle, expiresInSec: Math.floor(SESSION_TTL_MS / 1000) }
}

/**
 * Deliberately does not consume: the caller needs the delivery target on both
 * the success and the failure path, and consuming here would leave a failed
 * exchange with nowhere to send the browser.
 */
export async function findPendingNativeSession(
  handle: unknown,
): Promise<NativeDeliveryTarget | null> {
  if (typeof handle !== 'string' || handle === '') return null

  const session = await nativeAuthSessions().findOne({ _id: hashToken(handle), status: 'pending' })

  // Mongo's TTL reaper only runs about once a minute, so expiry is checked here.
  if (!session || session.expiresAt.getTime() <= Date.now()) return null

  return { redirectUri: session.redirectUri, clientState: session.clientState }
}

/**
 * Resolves a handle to its delivery target and nothing else, so the landing
 * page can bounce the browser back to the app when the sign-in call it was
 * about to make never returned.
 *
 * Deliberately weaker than redemption, and it must stay that way:
 *
 *   - it returns only where to send the browser — never the token, the userId,
 *     the code challenge, or any identity, all of which stay behind
 *     `{handle, codeVerifier, deliveryCode}`;
 *   - it neither consumes nor mutates, so a caller who hits a transient error
 *     and retries can still finish the sign-in;
 *   - it does not distinguish `pending` from `ready`. Redemption already tells
 *     a bare handle holder that much (409 `authorization_pending` is decided
 *     before the verifier is checked), so hiding it here would buy nothing —
 *     but neither should this endpoint be the place that starts leaking more.
 *
 * A caller holding a handle therefore learns exactly one new fact: a loopback
 * port on the machine whose browser is running the flow.
 */
export async function findNativeDeliveryTarget(
  handle: unknown,
): Promise<NativeDeliveryTarget | null> {
  if (typeof handle !== 'string' || handle === '') return null

  const session = await nativeAuthSessions().findOne({ _id: hashToken(handle) })

  if (!session || session.expiresAt.getTime() <= Date.now()) return null

  return { redirectUri: session.redirectUri, clientState: session.clientState }
}

/**
 * Binds an identity to the handle and mints the one-time code that the caller
 * must put on the loopback redirect. Returning the code (rather than storing it
 * for later lookup) is the point: it exists only in the redirect the browser
 * follows, so only the machine running that browser can redeem.
 *
 * The `status: 'pending'` precondition makes this a compare-and-set, so a
 * replayed browser callback cannot re-arm a handle that was already completed
 * (or already redeemed and deleted) — nor mint a second code for it.
 */
export async function completeNativeSession(
  handle: string,
  userId: string,
): Promise<{ deliveryCode: string } | null> {
  const deliveryCode = generateOpaqueToken()
  const result = await nativeAuthSessions().findOneAndUpdate(
    { _id: hashToken(handle), status: 'pending', expiresAt: { $gt: new Date() } },
    { $set: { status: 'ready', userId, deliveryCodeHash: hashToken(deliveryCode) } },
    { returnDocument: 'after' },
  )

  return result === null ? null : { deliveryCode }
}

/** Drops a registration whose browser leg failed, so it cannot be reused. */
export async function abandonNativeSession(handle: string): Promise<void> {
  await nativeAuthSessions().deleteOne({ _id: hashToken(handle) })
}

/**
 * Note what is *not* stored between the browser leg and this call: only a user
 * id. The token is minted here, so a snapshot of this collection contains no
 * usable credential.
 */
export async function redeemNativeSession(
  handle: unknown,
  codeVerifier: unknown,
  deliveryCode: unknown,
): Promise<{ token: string; user: NuphosUser }> {
  const invalid = new AppError(400, 'invalid_handle', 'This sign-in request is no longer valid')

  if (typeof handle !== 'string' || handle === '') throw invalid
  if (typeof codeVerifier !== 'string' || codeVerifier === '') throw invalid
  if (typeof deliveryCode !== 'string' || deliveryCode === '') throw invalid

  const id = hashToken(handle)
  const session = await nativeAuthSessions().findOne({ _id: id })

  if (!session || session.expiresAt.getTime() <= Date.now()) throw invalid

  if (session.status !== 'ready' || !session.userId || !session.deliveryCodeHash) {
    // Registered, but the browser leg has not finished. Distinguished from
    // "invalid" so the app can keep waiting instead of giving up.
    throw new AppError(409, 'authorization_pending', 'Sign-in has not completed yet')
  }

  // Verify BOTH secrets BEFORE consuming: a wrong one must not destroy a
  // session the legitimate app is about to redeem.
  if (!verifyPkceS256(codeVerifier, session.codeChallenge)) {
    throw new AppError(400, 'invalid_verifier', 'This sign-in request is no longer valid')
  }
  // Proof the redeemer received the loopback redirect. Without this, whoever
  // registered the handle could redeem an identity bound to somebody else.
  if (!safeEqualStr(hashToken(deliveryCode), session.deliveryCodeHash)) {
    throw new AppError(400, 'invalid_delivery_code', 'This sign-in request is no longer valid')
  }

  // Single-use, atomically. Two concurrent correct redemptions: exactly one
  // wins the delete and gets a token.
  const consumed = await nativeAuthSessions().findOneAndDelete({ _id: id, status: 'ready' })

  if (!consumed) throw invalid

  const user = await getNuphosUserById(consumed.userId!)

  if (!user) throw invalid

  return { token: signNuphosToken(user.id), user }
}
