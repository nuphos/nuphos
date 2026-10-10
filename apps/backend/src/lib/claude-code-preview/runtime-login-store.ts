import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from 'node:crypto'

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
  /**
   * The user's answer, sealed (`sealAnswer`): it can be an API key or an AWS secret, so it
   * is never stored readable, only until the replica driving the sign-in hands it on.
   */
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

// Derived from the JWT secret with its own context, as the email OTP key is, so the
// answers need no extra env var and stay out of reach of a database read.
let answerKey: Buffer | null = null

function answerCipherKey(): Buffer {
  if (!answerKey) {
    const secret = config.auth.jwtSecret

    if (!secret) throw new Error('NUPHOS_JWT_SECRET or JWT_SECRET_KEY is required for sign-in')
    answerKey = Buffer.from(hkdfSync('sha256', secret, '', 'nuphos-runtime-login-answer-v1', 32))
  }

  return answerKey
}

/** AES-256-GCM, bound to the attempt, so a sealed answer opens for that attempt only. */
export function sealAnswer(attemptId: string, answer: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', answerCipherKey(), iv).setAAD(Buffer.from(attemptId))
  const sealed = Buffer.concat([cipher.update(answer, 'utf8'), cipher.final()])

  return [iv, cipher.getAuthTag(), sealed].map((part) => part.toString('base64url')).join('.')
}

export function openAnswer(attemptId: string, sealed: string): string {
  const [iv, tag, data] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', answerCipherKey(), iv!)
    .setAAD(Buffer.from(attemptId))
    .setAuthTag(tag!)

  return Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8')
}

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
    { $set: { pendingCode: sealAnswer(doc.attemptId, code), codeSubmitted: true } },
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
