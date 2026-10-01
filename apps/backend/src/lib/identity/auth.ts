import { randomBytes } from 'node:crypto'

import { MongoServerError, ObjectId as MongoObjectId } from 'mongodb'

import type { NuphosUserDoc } from '@/lib/identity/shared'
import type { AuthenticatedIdentity, NuphosUser } from '@/lib/identity/types'

import { upsertCachedUser } from '@/lib/agent/directory'
import { getGoogleAccessToken, getGoogleProfile } from '@/lib/identity/google'
import { mapUser, teams, users } from '@/lib/identity/shared'
import { signNuphosToken, verifyNuphosToken } from '@/lib/identity/token'

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

export async function authenticateToken(token: string): Promise<AuthenticatedIdentity | null> {
  const nuphosUser = await authenticateNuphosToken(token)

  if (nuphosUser) {
    upsertCachedUser(nuphosUser)

    return { user: nuphosUser, cacheHit: false, provider: 'nuphos' }
  }

  return null
}

export async function signInWithGoogleCode(
  code: string,
  redirectUri: string,
): Promise<{ token: string; user: NuphosUser }> {
  const accessToken = await getGoogleAccessToken(code, redirectUri)
  const profile = await getGoogleProfile(accessToken)

  if (!profile.email) {
    throw new Error('Email is required')
  }
  if (!profile.verified_email) {
    throw new Error('Google email is not verified')
  }

  const normalizedEmail = profile.email.toLowerCase()
  let user =
    (await users().findOne({ googleID: profile.id, deletedAt: { $exists: false } })) ??
    (await users().findOne({ email: normalizedEmail, deletedAt: { $exists: false } }))

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
      user =
        (await users().findOne({ googleID: profile.id, deletedAt: { $exists: false } })) ??
        (await users().findOne({ email: normalizedEmail, deletedAt: { $exists: false } }))
      if (!user) throw err
    }
  }

  const nuphosUser = mapUser(user)

  upsertCachedUser(nuphosUser)

  return { token: signNuphosToken(user._id), user: nuphosUser }
}

// Sign in (or sign up) with an email address whose ownership has already been
// proven — e.g. via an OTP code. Callers must never pass an unverified email.
export async function signInWithVerifiedEmail(
  email: string,
): Promise<{ token: string; user: NuphosUser }> {
  const normalizedEmail = email.toLowerCase()
  let user = await users().findOne({ email: normalizedEmail, deletedAt: { $exists: false } })

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
      user = await users().findOne({ email: normalizedEmail, deletedAt: { $exists: false } })
      if (!user) throw err
    }
  }

  const nuphosUser = mapUser(user)

  upsertCachedUser(nuphosUser)

  return { token: signNuphosToken(user._id), user: nuphosUser }
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

async function authenticateNuphosToken(token: string): Promise<NuphosUser | null> {
  const claims = verifyNuphosToken(token)

  if (!claims) return null

  if (!MongoObjectId.isValid(claims.sub)) return null
  const user = await users().findOne({
    _id: new MongoObjectId(claims.sub),
    deletedAt: { $exists: false },
  })

  if (
    !user ||
    (user.sessionsInvalidBefore !== undefined &&
      (!Number.isFinite(claims.iat) || claims.iat < user.sessionsInvalidBefore))
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
