import { AppError } from '@/lib/errors'
import { createMfaChallenge, isMfaEnabled } from '@/lib/identity/mfa'
import { createUserSession } from '@/lib/identity/sessions'
import { isNewSignIn, sendNewSignInAlert } from '@/lib/identity/sign-in-alert'
import { signInSource } from '@/lib/request-origin'

import type { NuphosUser } from '@/lib/identity/types'
import type { Context } from 'hono'

// Every sign-in starts its session here. `viaWebsite`: nuphos.ai's server made
// the call, so the address seen is the website's, not the visitor's.
export async function startSession(c: Context, user: NuphosUser, viaWebsite = false) {
  // With two-factor authentication on, the first factor earns only a
  // challenge; POST /auth/mfa/verify trades it and a code for the session.
  // Apps that predate it show the message, which asks them to update.
  if (await isMfaEnabled(user.id)) {
    throw new AppError(
      401,
      'mfa_required',
      'Enter the code from your authenticator app. If Nuphos does not ask for one, update the app.',
      { mfaToken: await createMfaChallenge(user.id) },
    )
  }

  return issueSession(c, user, viaWebsite)
}

/** The session itself, once every factor the account requires has passed. */
export async function issueSession(c: Context, user: NuphosUser, viaWebsite = false) {
  const seen = signInSource((name) => c.req.header(name))
  const source = viaWebsite ? { client: seen.client, userAgent: seen.userAgent } : seen
  // Compared with the account's other sessions before this one joins them.
  const isNew = await isNewSignIn(user, source)
  const token = await createUserSession(user.id, source)

  if (isNew) void sendNewSignInAlert(user, source)

  return { token, user }
}
