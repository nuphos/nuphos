import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'
import { isMfaEnabled } from '@/lib/identity/mfa'
import { userSessions } from '@/lib/identity/sessions'

/**
 * Step-up re-authentication. A session counts as recently verified for
 * WINDOW_MS after it was signed in to, or after its last `markVerified` (a
 * code entered on POST /auth/mfa/reauth). With MFA on, sign-in itself needed
 * the second factor, so either moment is a second-factor check.
 *
 * MFA is optional, so accounts without it are only asked for a recent sign-in
 * where `forEveryAccount` says so (turning MFA on); elsewhere they pass.
 */
const WINDOW_MS = 10 * 60 * 1000

export async function requireRecentVerification(
  userId: string,
  sessionId: string | undefined,
  forEveryAccount = false,
): Promise<void> {
  if (!sessionId) throw new AppError(403, 'session_required', 'Sign in again to continue')
  const mfa = await isMfaEnabled(userId)

  if (!mfa && !forEveryAccount) return
  const session = await userSessions().findOne(
    { _id: new ObjectId(sessionId) },
    { projection: { createdAt: 1, verifiedAt: 1 } },
  )
  const verifiedAt = session?.verifiedAt ?? session?.createdAt

  if (verifiedAt && Date.now() - verifiedAt.getTime() < WINDOW_MS) return
  // `method` tells the app what to ask for: a code, or signing in again.
  throw new AppError(
    403,
    'reauth_required',
    mfa ? 'Enter a code from your authenticator app to continue.' : 'Sign in again to continue.',
    { method: mfa ? 'mfa' : 'sign_in' },
  )
}

export async function markVerified(sessionId: string): Promise<void> {
  await userSessions().updateOne(
    { _id: new ObjectId(sessionId) },
    { $set: { verifiedAt: new Date() } },
  )
}
