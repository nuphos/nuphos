import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { AppError } from '@/lib/errors'
import { users } from '@/lib/identity/shared'

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'

/**
 * Passkeys (WebAuthn) as another second factor, next to the authenticator app.
 * They are added to an account that already has two-factor authentication on,
 * so the recovery codes and every existing check stay as they are; a passkey
 * is simply one more way to answer `verifySecondFactor` (mfa.ts).
 *
 * Only public keys are stored. A ceremony's challenge lives on the account for
 * a session (adding a passkey, step-up) and on the sign-in challenge for a
 * sign-in (`mfa-challenge.ts`), for CHALLENGE_TTL_MS.
 */
export type StoredPasskey = {
  /** The credential ID, base64url. */
  id: string
  /** The COSE public key, base64url. */
  publicKey: string
  counter: number
  transports?: string[]
  name: string
  createdAt: Date
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const MAX_PASSKEYS = 10

const rp = () => ({ rpID: config.webauthn.rpId, origins: config.webauthn.origins })

export function publicPasskeys(passkeys: StoredPasskey[] | undefined) {
  return (passkeys ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt.toISOString(),
  }))
}

async function account(userId: string) {
  const doc = await users().findOne(
    { _id: new ObjectId(userId), deletedAt: { $exists: false } },
    { projection: { email: 1, mfa: 1, passkeyChallenge: 1 } },
  )

  if (!doc) throw new AppError(401, 'unauthorized', 'Account is no longer available')
  if (!doc.mfa) {
    throw new AppError(
      400,
      'mfa_not_enabled',
      'Turn on two-factor authentication with an authenticator app first',
    )
  }

  return { ...doc, mfa: doc.mfa }
}

async function remember(userId: string, challenge: string) {
  await users().updateOne(
    { _id: new ObjectId(userId) },
    { $set: { passkeyChallenge: { value: challenge, createdAt: new Date() } } },
  )
}

/** What the app passes to `navigator.credentials.create()` (or the platform API). */
export async function passkeyRegistrationOptions(userId: string) {
  const { email, mfa } = await account(userId)

  if ((mfa.passkeys?.length ?? 0) >= MAX_PASSKEYS) {
    throw new AppError(409, 'too_many_passkeys', 'Remove a passkey before adding another')
  }
  const options = await generateRegistrationOptions({
    rpName: 'Nuphos',
    rpID: rp().rpID,
    userName: email,
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    excludeCredentials: (mfa.passkeys ?? []).map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })

  await remember(userId, options.challenge)

  return options
}

export async function addPasskey(userId: string, response: unknown, name: unknown) {
  const { passkeyChallenge } = await account(userId)

  if (!passkeyChallenge || Date.now() - passkeyChallenge.createdAt.getTime() > CHALLENGE_TTL_MS) {
    throw new AppError(400, 'passkey_challenge_expired', 'Start adding the passkey again')
  }
  const verified = await verifyRegistrationResponse({
    response: response as RegistrationResponseJSON,
    expectedChallenge: passkeyChallenge.value,
    expectedOrigin: rp().origins,
    expectedRPID: rp().rpID,
    requireUserVerification: false,
  }).catch(() => null)
  const credential = verified?.verified ? verified.registrationInfo.credential : null

  if (!credential) throw new AppError(400, 'invalid_passkey', 'That passkey could not be verified')
  const passkey: StoredPasskey = {
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    ...(credential.transports ? { transports: credential.transports } : {}),
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 64) : 'Passkey',
    createdAt: new Date(),
  }

  await users().updateOne(
    { _id: new ObjectId(userId), 'mfa.passkeys.id': { $ne: passkey.id } },
    { $push: { 'mfa.passkeys': passkey }, $unset: { passkeyChallenge: '' } },
  )

  return publicPasskeys([passkey])[0]
}

export async function removePasskey(userId: string, id: string): Promise<boolean> {
  const { modifiedCount } = await users().updateOne(
    { _id: new ObjectId(userId) },
    { $pull: { 'mfa.passkeys': { id } } },
  )

  return modifiedCount === 1
}

/** Options for proving a passkey; the challenge is kept by the caller. */
export async function passkeyAssertionOptions(passkeys: StoredPasskey[] | undefined) {
  if (!passkeys?.length) throw new AppError(400, 'no_passkeys', 'This account has no passkeys')

  return generateAuthenticationOptions({
    rpID: rp().rpID,
    allowCredentials: passkeys.map((p) => ({ id: p.id, transports: p.transports })),
    userVerification: 'preferred',
  })
}

/** For step-up and settings: the challenge is kept on the account. */
export async function sessionPasskeyOptions(userId: string) {
  const { mfa } = await account(userId)
  const options = await passkeyAssertionOptions(mfa.passkeys)

  await remember(userId, options.challenge)

  return options
}

/** The passkey that answered `challenge`, with its new signature counter, or null. */
export async function checkPasskey(
  passkeys: StoredPasskey[] | undefined,
  response: unknown,
  challenge: string,
): Promise<{ id: string; counter: number } | null> {
  const answer = response as AuthenticationResponseJSON
  const passkey = passkeys?.find((p) => p.id === answer?.id)

  if (!passkey) return null
  const verified = await verifyAuthenticationResponse({
    response: answer,
    expectedChallenge: challenge,
    expectedOrigin: rp().origins,
    expectedRPID: rp().rpID,
    credential: {
      id: passkey.id,
      publicKey: Buffer.from(passkey.publicKey, 'base64url'),
      counter: passkey.counter,
      transports: passkey.transports,
    },
    requireUserVerification: false,
  }).catch(() => null)

  return verified?.verified
    ? { id: passkey.id, counter: verified.authenticationInfo.newCounter }
    : null
}

/** A challenge kept on the account, if it is still fresh. */
export function freshChallenge(
  kept: { value: string; createdAt: Date } | undefined,
): string | undefined {
  return kept && Date.now() - kept.createdAt.getTime() <= CHALLENGE_TTL_MS ? kept.value : undefined
}

/** Whether `response` is a passkey's valid answer to `challenge`; spends the challenge if so. */
export async function answeredWithPasskey(
  _id: ObjectId,
  passkeys: StoredPasskey[] | undefined,
  response: unknown,
  challenge: string,
  fromAccount: boolean,
): Promise<boolean> {
  const hit =
    response && typeof response === 'object'
      ? await checkPasskey(passkeys, response, challenge)
      : null

  if (!hit) return false
  // Spending the account's challenge is the gate: two requests replaying one
  // answer cannot both pass. A sign-in's challenge is spent with the sign-in.
  const { modifiedCount } = await users().updateOne(
    {
      _id,
      'mfa.passkeys.id': hit.id,
      ...(fromAccount ? { 'passkeyChallenge.value': challenge } : {}),
    },
    {
      $set: { 'mfa.passkeys.$.counter': hit.counter },
      $unset: { mfaFailures: '', passkeyChallenge: '' },
    },
  )

  return modifiedCount === 1
}
