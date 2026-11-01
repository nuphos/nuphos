import { createUserSession } from '@/lib/identity/sessions'
import { isNewSignIn, sendNewSignInAlert } from '@/lib/identity/sign-in-alert'
import { signInSource } from '@/lib/request-origin'

import type { NuphosUser } from '@/lib/identity/types'
import type { Context } from 'hono'

// Every sign-in starts its session here. `viaWebsite`: nuphos.ai's server made
// the call, so the address seen is the website's, not the visitor's.
export async function startSession(c: Context, user: NuphosUser, viaWebsite = false) {
  const seen = signInSource((name) => c.req.header(name))
  const source = viaWebsite ? { client: seen.client, userAgent: seen.userAgent } : seen
  // Compared with the account's other sessions before this one joins them.
  const isNew = await isNewSignIn(user, source)
  const token = await createUserSession(user.id, source)

  if (isNew) void sendNewSignInAlert(user, source)

  return { token, user }
}
