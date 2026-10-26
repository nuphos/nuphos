import { randomBytes } from 'node:crypto'

import { MongoServerError, ObjectId as MongoObjectId } from 'mongodb'

import type { NuphosUserDoc } from '@/lib/identity/shared'
import type { AuthenticatedIdentity, NuphosUser } from '@/lib/identity/types'

import { upsertCachedUser } from '@/lib/agent/directory'
import { AppError } from '@/lib/errors'
import { getGoogleAccessToken, getGoogleProfile } from '@/lib/identity/google'
import { mapUser, teams, users } from '@/lib/identity/shared'
import { findLiveSession, isSessionToken } from '@/lib/identity/sessions'
import { verifyNuphosToken } from '@/lib/identity/token'

export { signNuphosToken } from '@/lib/identity/token'

export async function setupIdentityIndexes(): Promise<void> {
  await Promise.all([
    users().createIndex({ email: 1 }, { unique: true, background: true }),
    users().createIndex({ googleID: 1 }, { unique: true, sparse: true, background: true }),
    users().createIndex({ username: 1 }, { unique: true, background: true }),
    teams().createIndex({ ownerID: 1 }, { background: true }),
    teams().createIndex({ 'members.userId': 1 }, { background: true }),
    teams().createIndex({ allowedEmailDomains: 1 }, { sparse: true, background: true }),
  ])
}

/**
 * A sign-in session (`nus_…`), or a short-lived JWT the backend minted for an
 * agent run. Only a session carries `sessionId`; routes that manage the
 * account's sign-ins require it.
 */
export async function authenticateToken(token: string): Promise<AuthenticatedIdentity | null> {
  const session = isSessionToken(token) ? await findLiveSession(token) : null
  const claims = session ? null : verifyNuphosToken(token)
  const credential = session
    ? { userId: session.userId, issuedAt: session.createdAt }
    : claims && { userId: claims.sub, issuedAt: new Date(claims.iat * 1000) }

  if (!credential) return null
  const user = await getNuphosUserForCredential(credential.userId, credential.issuedAt)

  if (!user) return null
  upsertCachedUser(user)

  return {
    user,
    cacheHit: false,
    provider: 'nuphos',
    ...(session ? { sessionId: session._id.toHexString() } : {}),
  }
}

/**
 * A deleted account is a disabled one. Signing in with its email or Google
 * identity is refused rather than creating a second account for that email.
 */
function refuseDisabled<T extends { deletedAt?: Date } | null>(user: T): T {
  if (user?.deletedAt) throw new AppError(403, 'account_disabled', 'This account has been disabled')

  return user
}

export async function signInWithGoogleCode(code: string, redirectUri: string): Promise<NuphosUser> {
  const accessToken = await getGoogleAccessToken(code, redirectUri)
  const profile = await getGoogleProfile(accessToken)

  if (!profile.email) {
    throw new Error('Email is required')
  }
  if (!profile.verified_email) {
    throw new Error('Google email is not verified')
  }

  const normalizedEmail = profile.email.toLowerCase()
  let user = refuseDisabled(
    (await users().findOne({ googleID: profile.id })) ??
      (await users().findOne({ email: normalizedEmail })),
  )

  const now = new Date()

  if (user) {
    const update: Partial<NuphosUserDoc> = {
      googleID: profile.id,
      ...(user.profileEdited
        ? {}
        : { name: profile.name || user.name, avatarURL: profile.picture || user.avatarURL || '' }),
      updatedAt: now,
    }

    await users().updateOne({ _id: user._id }, { $set: update })
    user = { ...user, ...update }
  } else {
    const _id = new MongoObjectId()

    user = {
      _id,
      email: normalizedEmail,
      name: profile.name || normalizedEmail,
      username: await uniqueUsername(normalizedEmail),
      avatarURL: profile.picture || '',
      language: 'en-US',
      googleID: profile.id,
      createdAt: now,
      updatedAt: now,
    }
    try {
      await users().insertOne(user)
    } catch (err) {
      if (!(err instanceof MongoServerError) || err.code !== 11000) throw err
      user = refuseDisabled(
        (await users().findOne({ googleID: profile.id })) ??
          (await users().findOne({ email: normalizedEmail })),
      )
      if (!user) throw err
    }
  }

  const nuphosUser = mapUser(user)

  upsertCachedUser(nuphosUser)

  return nuphosUser
}

// Sign in (or sign up) with an email address whose ownership has already been
// proven — e.g. via an OTP code. Callers must never pass an unverified email.
export async function signInWithVerifiedEmail(email: string): Promise<NuphosUser> {
  const normalizedEmail = email.toLowerCase()
  let user = refuseDisabled(await users().findOne({ email: normalizedEmail }))

  if (!user) {
    const now = new Date()
    const candidate: NuphosUserDoc = {
      _id: new MongoObjectId(),
      email: normalizedEmail,
      name: normalizedEmail,
      username: await uniqueUsername(normalizedEmail),
      avatarURL: '',
      language: 'en-US',
      createdAt: now,
      updatedAt: now,
    }

    try {
      await users().insertOne(candidate)
      user = candidate
    } catch (err) {
      if (!(err instanceof MongoServerError) || err.code !== 11000) throw err
      user = refuseDisabled(await users().findOne({ email: normalizedEmail }))
      if (!user) throw err
    }
  }

  const nuphosUser = mapUser(user)

  upsertCachedUser(nuphosUser)

  return nuphosUser
}

/** Loads a live (non-deleted) user by id. */
export async function getNuphosUserById(userId: string): Promise<NuphosUser | null> {
  if (!MongoObjectId.isValid(userId)) return null
  const user = await users().findOne({
    _id: new MongoObjectId(userId),
    deletedAt: { $exists: false },
  })

  return user ? mapUser(user) : null
}

/**
 * The live user behind a credential issued at `issuedAt`, unless "sign out
 * everywhere" (a password reset) happened since, as for session tokens.
 */
export async function getNuphosUserForCredential(
  userId: string,
  issuedAt: Date,
): Promise<NuphosUser | null> {
  if (!MongoObjectId.isValid(userId)) return null
  const user = await users().findOne({
    _id: new MongoObjectId(userId),
    deletedAt: { $exists: false },
  })

  const issued = Math.floor(issuedAt.getTime() / 1000)

  if (
    !user ||
    (user.sessionsInvalidBefore !== undefined &&
      (!Number.isFinite(issued) || issued < user.sessionsInvalidBefore))
  )
    return null

  return mapUser(user)
}

async function uniqueUsername(email: string): Promise<string> {
  const local = email.split('@')[0] ?? 'user'
  const base = local.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'user'
  let candidate = base

  while (await users().findOne({ username: candidate })) {
    candidate = `${base}${randomBytes(2).toString('hex')}`
  }

  return candidate
}
