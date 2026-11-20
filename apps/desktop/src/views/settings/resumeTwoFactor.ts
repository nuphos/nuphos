import { readLocalStorage, writeLocalStorage } from '../../app/localStorage'

// Turning two-factor authentication on can ask for a fresh sign-in. The person
// signs out for it, so the next workspace opens on that section, once.
const KEY = 'nuphos.resumeTwoFactor'

export function resumeTwoFactorAfterSignIn(): void {
  writeLocalStorage(KEY, '1')
}

export function wantsTwoFactorResume(): boolean {
  return readLocalStorage(KEY) === '1'
}

export function clearTwoFactorResume(): void {
  writeLocalStorage(KEY, '')
}
