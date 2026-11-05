import { authSession } from '../auth-session.ts'

import { readConfig } from './config.ts'

import type { AccountContext } from '../auth-session.ts'

/**
 * The account a request goes out as: one context, so its backend, token and
 * signal always belong together. Until the startup check has run the token
 * comes from the file; once anything has set the session, only from memory.
 */
export async function requestContext(): Promise<AccountContext> {
  const ctx = authSession.context()

  if (ctx.token || authSession.settled()) return ctx
  // An unreadable sign-in is for the startup check to report: a request goes
  // out without a token, so the login screen (its endpoint field) keeps working.
  const { token } = await readConfig().catch(() => ({ token: undefined }))
  const now = authSession.context()

  return now === ctx && token ? { ...ctx, token } : now
}
