// Keeps a cancelled sign-in from being saved after the fact.
//
// While signed in as A, "Add account" signs in to B on top of it, and saving
// B's token switches the app to B. Closing the OAuth callback listener
// (`cancelPendingLogin`) does not stop a sign-in already past it:
//   - the browser has delivered its code and the redeem request is out,
//   - the legacy landing page has delivered a token and `fetchUserInfo` is out,
//   - an email code was submitted and `verifyEmailCode` is waiting.
// Without this, such a request still reached `writeConfig` and switched to B
// after the user had pressed Cancel and was back in A's workspace.
//
// Each sign-in takes an attempt when it starts (`beginSignIn`); Cancel or a
// newer sign-in voids it (`cancelSignIns`); every path calls `assertWanted`
// right before `writeConfig`, so a voided attempt saves nothing.

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
