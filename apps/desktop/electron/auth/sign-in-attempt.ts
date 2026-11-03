// Keeps a cancelled sign-in from being saved after the fact.
//
// While signed in as A, "Add account" signs in to B on top of it, and saving
// B's token switches the app to B and reloads every window. Cancel used to
// only close the OAuth callback listener (`cancelPendingLogin`), which does
// not stop a sign-in already past it:
//   - the browser has delivered its code and the redeem request is out,
//   - the legacy landing page has delivered a token and `fetchUserInfo` is out,
//   - an email code was submitted and `verifyEmailCode` is waiting.
// When that request came back it still called `writeConfig`, so someone who
// pressed Cancel and was back in A's workspace was switched to B anyway.
//
// So each sign-in takes an attempt when it starts (`beginSignIn`). Cancel, or
// starting another sign-in, voids it (`cancelSignIns`). Every path checks
// `assertWanted` right before `writeConfig`, and a voided attempt saves nothing.
// Before accounts could be added while signed in, the worst case of a late
// token was landing in the workspace from the sign-in screen; now it is a
// switch the user said no to.

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
