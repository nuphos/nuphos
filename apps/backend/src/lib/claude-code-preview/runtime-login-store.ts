import { createHash, randomUUID } from 'node:crypto'

import { config } from '@/config'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'

import type { RuntimeLoginStep } from './runtime-login-step'

export type RuntimeLoginStatus = {
  attemptId: string
  state: 'starting' | 'awaiting_authorization' | 'connected' | 'failed' | 'cancelled'
  verificationUri?: string
  userCode?: string
  /** A browser flow that ends in a code the user pastes back into the app. */
  authorizationUrl?: string
  /** What a stepped sign-in asks of the user now. */
  step?: RuntimeLoginStep
  codeSubmitted?: boolean
  error?: string
  expiresAt: string
}
export type RuntimeLoginDoc = Omit<RuntimeLoginStatus, 'expiresAt'> & {
  _id: string
  teamId: string
  runtimeId: string
  userId: string
  expiresAt: Date
  /** Held only until the replica driving the sign-in hands it to the runtime. */
  pendingCode?: string
}
/** What a sign-in that leaves `awaiting_authorization` must no longer show or hold. */
export const AUTHORIZATION_FIELDS = {
  userCode: '',
  verificationUri: '',
  authorizationUrl: '',
  step: '',
  pendingCode: '',
} as const

export const runtimeLogins = () => db().collection<RuntimeLoginDoc>('runtime_login_attempts')
export function runtimeLoginKey(teamId: string, runtimeId: string): string {
  return createHash('sha256')
    .update(`${teamId}|${runtimeId}|${config.claudeCodeRuntimeProvisioner.namespace}`)
    .digest('hex')
}
export function publicLogin(doc: RuntimeLoginDoc): RuntimeLoginStatus {
  const expired =
    doc.expiresAt.getTime() < Date.now() &&
    !['connected', 'failed', 'cancelled'].includes(doc.state)

  return {
    attemptId: doc.attemptId,
    state: expired ? 'failed' : doc.state,
    expiresAt: doc.expiresAt.toISOString(),
    ...(expired
      ? { error: 'Sign-in expired. Start again.' }
      : {
          ...(doc.error ? { error: doc.error } : {}),
          ...(doc.state === 'awaiting_authorization'
            ? doc.step
              ? { step: doc.step, ...(doc.codeSubmitted ? { codeSubmitted: true } : {}) }
              : doc.authorizationUrl
                ? {
                    authorizationUrl: doc.authorizationUrl,
                    ...(doc.codeSubmitted ? { codeSubmitted: true } : {}),
                  }
                : { verificationUri: doc.verificationUri, userCode: doc.userCode }
            : {}),
        }),
  }
}

export async function readRuntimeLogin(
  teamId: string,
  runtimeId: string,
  userId: string,
): Promise<RuntimeLoginDoc> {
  const doc = await runtimeLogins().findOne({ _id: runtimeLoginKey(teamId, runtimeId), userId })

  if (!doc)
    throw new AppError(404, 'runtime_login_not_found', 'No sign-in is in progress for this account')

  return doc
}
/** The replica driving the sign-in collects the code; any replica may accept it. */
export async function submitLoginCode(
  doc: RuntimeLoginDoc,
  code: string,
): Promise<RuntimeLoginStatus> {
  const result = await runtimeLogins().updateOne(
    {
      _id: doc._id,
      attemptId: doc.attemptId,
      state: 'awaiting_authorization',
      $or: [
        { authorizationUrl: { $exists: true } },
        { 'step.kind': { $in: ['choose', 'input'] } },
        { 'step.paste': { $exists: true } },
      ],
      codeSubmitted: { $ne: true },
      expiresAt: { $gt: new Date() },
    },
    { $set: { pendingCode: code, codeSubmitted: true } },
  )

  if (!result.matchedCount)
    throw new AppError(
      409,
      'runtime_login_not_waiting',
      'This sign-in is no longer waiting for a code. Start again.',
    )

  return publicLogin({ ...doc, codeSubmitted: true })
}

/**
 * The newest sign-in wins: a new attempt replaces whatever this runtime had, and the
 * replica driving the old one sees its attempt gone and stops it.
 */
export async function claimRuntimeLogin(
  teamId: string,
  runtimeId: string,
  userId: string,
): Promise<RuntimeLoginDoc> {
  const doc: RuntimeLoginDoc = {
    _id: runtimeLoginKey(teamId, runtimeId),
    teamId,
    runtimeId,
    userId,
    attemptId: randomUUID(),
    state: 'starting',
    expiresAt: new Date(Date.now() + 20 * 60_000),
  }

  await runtimeLogins().replaceOne({ _id: doc._id }, doc, { upsert: true })

  return doc
}

export async function setupRuntimeLoginIndexes(): Promise<void> {
  await runtimeLogins().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 3600 })
}
