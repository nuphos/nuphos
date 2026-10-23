import { createPublicKey, sign, verify } from 'node:crypto'

import { MongoServerError, ObjectId } from 'mongodb'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { uniqueUsername } from '@/lib/identity/auth'
import { mapUser, users } from '@/lib/identity/shared'
import { signNuphosToken } from '@/lib/identity/token'
import { safeEqualStr } from '@/lib/oauth/tokens'

import type { webcrypto } from 'node:crypto'

export type SocialProvider = 'google' | 'apple'
export type SocialClaims = {
  sub: string
  email?: string
  email_verified?: boolean | string
  name?: string
  picture?: string
}
const endpoints = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    keys: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
  },
  apple: {
    authorize: 'https://appleid.apple.com/auth/authorize',
    token: 'https://appleid.apple.com/auth/token',
    keys: 'https://appleid.apple.com/auth/keys',
    issuer: ['https://appleid.apple.com'],
  },
}
const keyCache = new Map<
  string,
  { until: number; keys: (webcrypto.JsonWebKey & { kid?: string; alg?: string; use?: string })[] }
>()

export function providerSettings(provider: SocialProvider) {
  const clientId = config.auth[provider].clientId
  let secret: string | undefined

  if (provider === 'google') secret = config.auth.google.clientSecret
  else {
    const apple = config.auth.apple

    if (clientId && apple.teamId && apple.keyId && apple.privateKey) {
      const now = Math.floor(Date.now() / 1000)
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: apple.keyId })).toString(
        'base64url',
      )
      const body = Buffer.from(
        JSON.stringify({
          iss: apple.teamId,
          sub: clientId,
          aud: 'https://appleid.apple.com',
          iat: now,
          exp: now + 300,
        }),
      ).toString('base64url')
      const unsigned = `${header}.${body}`
      const signature = sign('sha256', Buffer.from(unsigned), {
        key: apple.privateKey.replace(/\\n/g, '\n'),
        dsaEncoding: 'ieee-p1363',
      })

      secret = `${unsigned}.${signature.toString('base64url')}`
    }
  }
  if (!clientId || !secret)
    throw new AppError(503, 'provider_unavailable', `${provider} sign-in is not configured`)

  return {
    ...endpoints[provider],
    clientId,
    secret,
    redirectUri: `${config.auth.publicBaseUrl}/auth/social/${provider}/callback`,
  }
}

export function validateClaims(
  claims: Record<string, unknown>,
  provider: SocialProvider,
  audience: string,
  nonce: string,
): SocialClaims {
  const now = Math.floor(Date.now() / 1000)

  if (
    !endpoints[provider].issuer.includes(String(claims.iss)) ||
    claims.aud !== audience ||
    typeof claims.exp !== 'number' ||
    claims.exp <= now ||
    typeof claims.iat !== 'number' ||
    claims.iat > now + 60 ||
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    typeof claims.nonce !== 'string' ||
    !safeEqualStr(claims.nonce, nonce)
  ) {
    throw new AppError(401, 'invalid_identity', 'Provider identity could not be verified')
  }

  return claims as SocialClaims
}

export async function exchangeSocialCode(
  provider: SocialProvider,
  code: string,
  nonce: string,
): Promise<SocialClaims> {
  const settings = providerSettings(provider)
  const response = await fetch(settings.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: settings.clientId,
      client_secret: settings.secret,
      redirect_uri: settings.redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const result = (await response.json()) as { id_token?: string }

  if (!response.ok || typeof result.id_token !== 'string')
    throw new AppError(
      401,
      'provider_exchange_failed',
      'Provider sign-in failed. Please try again.',
    )
  if (result.id_token.length > 16_384)
    throw new AppError(401, 'invalid_identity', 'Invalid provider token')
  const parts = result.id_token.split('.')

  const [headerPart, payloadPart, signaturePart] = parts

  if (parts.length !== 3 || !headerPart || !payloadPart || !signaturePart)
    throw new AppError(401, 'invalid_identity', 'Invalid provider token')
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString()) as {
    alg?: string
    kid?: string
  }

  if (header.alg !== 'RS256' || typeof header.kid !== 'string')
    throw new AppError(401, 'invalid_identity', 'Invalid provider signature')
  let cached = keyCache.get(provider)

  if (!cached || cached.until <= Date.now() || !cached.keys.some((k) => k.kid === header.kid)) {
    const response = await fetch(settings.keys, { signal: AbortSignal.timeout(10_000) })

    if (!response.ok)
      throw new AppError(503, 'provider_unavailable', 'Provider verification unavailable')
    const body = (await response.json()) as { keys: (webcrypto.JsonWebKey & { kid?: string })[] }

    cached = { until: Date.now() + 3_600_000, keys: body.keys }
    keyCache.set(provider, cached)
  }
  const jwk = cached.keys.find(
    (k) =>
      k.kid === header.kid &&
      k.kty === 'RSA' &&
      (!k.alg || k.alg === 'RS256') &&
      (!k.use || k.use === 'sig'),
  )

  if (
    !jwk ||
    !verify(
      'RSA-SHA256',
      Buffer.from(`${headerPart}.${payloadPart}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(signaturePart, 'base64url'),
    )
  )
    throw new AppError(401, 'invalid_identity', 'Invalid provider signature')

  return validateClaims(
    JSON.parse(Buffer.from(payloadPart, 'base64url').toString()),
    provider,
    settings.clientId,
    nonce,
  )
}

export async function signInSocial(provider: SocialProvider, claims: SocialClaims) {
  const field = provider === 'google' ? 'googleID' : 'appleID'
  const query = { [field]: claims.sub, deletedAt: { $exists: false } }
  let user = await users().findOne(query)

  if (!user) {
    if (!claims.email || (claims.email_verified !== true && claims.email_verified !== 'true'))
      throw new AppError(401, 'email_required', 'A verified email is required for a new account')
    const email = claims.email.toLowerCase()

    if (await users().findOne({ email }))
      throw new AppError(
        409,
        'account_exists',
        'Sign in with the existing account method. Accounts are not linked by email.',
      )
    const now = new Date()
    const candidate = {
      _id: new ObjectId(),
      email,
      name: claims.name || email,
      username: await uniqueUsername(email),
      avatarURL: claims.picture || '',
      language: 'en-US',
      [field]: claims.sub,
      createdAt: now,
      updatedAt: now,
    }

    try {
      await users().insertOne(candidate)
      user = candidate
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error
      user = await users().findOne(query)
      if (!user)
        throw new AppError(
          409,
          'account_exists',
          'This account already exists. Use its existing sign-in method.',
        )
    }
  }

  return { token: signNuphosToken(user._id), user: mapUser(user) }
}
