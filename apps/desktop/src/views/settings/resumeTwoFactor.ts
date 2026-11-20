import { readLocalStorage, writeLocalStorage } from '../../app/localStorage'

// Turning two-factor authentication on can ask for a fresh sign-in. The person
// signs out for it, so the next sign-in opens the section again, once.
const KEY = 'nuphos.resumeTwoFactor'

export function resumeTwoFactorAfterSignIn(): void {
  writeLocalStorage(KEY, '1')
}

export function takeTwoFactorResume(): boolean {
  if (readLocalStorage(KEY) !== '1') return false
  writeLocalStorage(KEY, '')

  return true
}
