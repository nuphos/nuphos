import { ObjectId } from 'mongodb'

import { users } from '@/lib/identity/shared'
import { logError } from '@/lib/observability'
import { setPersonOnce } from '@/lib/posthog'

import type { NuphosUser } from '@/lib/identity/types'

/**
 * nuphos.ai writes this cookie on `.nuphos.ai` at a browser's first visit, so
 * api.nuphos.ai sees it on any sign-in the same browser reaches.
 */
export const FIRST_TOUCH_COOKIE = 'nuphos_first_touch'

/** Where a new account came from, saved once on the user. */
export type SignupSource = {
  /** The sign-in path, e.g. `google`, `apple`, `email`. */
  via: string
  channel?: string
  source?: string
  medium?: string
  campaign?: string
  referringDomain?: string
}

const FIELDS = ['channel', 'source', 'medium', 'campaign', 'referringDomain'] as const

// Only an account this new is a signup; older ones are signing in again.
const SIGNUP_WINDOW_MS = 60 * 60 * 1000

/** The cookie's JSON, keeping only short string fields. Browser input, so anything else is dropped. */
export function parseFirstTouch(raw: unknown): Omit<SignupSource, 'via'> {
  let value: unknown

  try {
    value = typeof raw === 'string' && raw ? JSON.parse(raw) : null
  } catch {
    return {}
  }
  if (!value || typeof value !== 'object') return {}
  const parsed: Omit<SignupSource, 'via'> = {}

  for (const field of FIELDS) {
    const v = (value as Record<string, unknown>)[field]

    if (typeof v === 'string' && v && v.length <= 200) parsed[field] = v
  }

  return parsed
}

/**
 * Saves the source on a user created in the last hour that has none yet, and
 * sets it once on the PostHog person. Every new account gets one, so a missing
 * `channel` means no first-touch cookie reached this sign-in. Never fails the sign-in.
 */
export async function recordSignupSource(
  user: NuphosUser,
  via: string,
  firstTouch: unknown,
): Promise<void> {
  if (Date.now() - Date.parse(user.createdAt) > SIGNUP_WINDOW_MS) return
  const signupSource: SignupSource = { via, ...parseFirstTouch(firstTouch) }

  try {
    const { modifiedCount } = await users().updateOne(
      { _id: new ObjectId(user.id), signupSource: { $exists: false } },
      { $set: { signupSource } },
    )

    if (!modifiedCount) return
  } catch (error) {
    logError('signup_source.record_failed', error, { via })

    return
  }
  setPersonOnce(user.id, {
    signup_via: via,
    signup_channel: signupSource.channel,
    signup_source: signupSource.source,
    signup_medium: signupSource.medium,
    signup_campaign: signupSource.campaign,
    signup_referring_domain: signupSource.referringDomain,
  })
}
