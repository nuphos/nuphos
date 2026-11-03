// A sign-in belongs to the attempt that started it. Cancel, or a newer
// attempt, voids it: a token that arrives afterwards is never saved, so a
// cancelled "Add account" cannot switch accounts behind the user's back.

let current = 0

/** Whether the attempt is still the one wanted. */
export type SignInAttempt = () => boolean

export function beginSignIn(): SignInAttempt {
  current += 1
  const mine = current

  return () => mine === current
}

export function cancelSignIns(): void {
  current += 1
}

/** Throws if the attempt was cancelled or replaced; call right before saving its token. */
export function assertWanted(attempt: SignInAttempt): void {
  if (!attempt()) throw new Error('Sign-in cancelled')
}
