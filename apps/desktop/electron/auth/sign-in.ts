import { loginApiUrl, stageLoginApiUrl } from '../api-endpoint.ts'

import { writeConfig } from './config.ts'

import type { Config } from './config.ts'

// Each sign-in attempt has a number; cancelling one moves it on, so a sign-in
// that completes afterwards (a browser callback already being redeemed, an
// email code already submitted) is dropped instead of switching accounts.
let attempt = 0

/** A sign-in in progress: its number, and the backend it was started on. */
export type SignInAttempt = { id: number; api: string }

/** The attempt a sign-in starting now belongs to. */
export function signInAttempt(): SignInAttempt {
  return { id: attempt, api: loginApiUrl() }
}

/** Starts a new attempt, dropping whatever the previous one completes. */
export function cancelSignIn(): number {
  attempt += 1

  return attempt
}

/** Saves a completed sign-in, on the backend it was started on, unless its attempt was cancelled. */
export async function saveSignIn(of: SignInAttempt, cfg: Config): Promise<void> {
  if (of.id !== attempt) throw new Error('Sign-in cancelled')
  await writeConfig({ ...cfg, apiUrl: of.api })
  stageLoginApiUrl(null)
}
