import { parseAtlasError } from '../../../api/errors.ts'

/**
 * What the secure input card can do after a save failed. A runtime that cannot
 * take the value inline refuses it by design — an older Desktop on the agent's
 * computer, which only an update there fixes — so the card names that instead
 * of offering a retry that would fail the same way. Everything else (offline,
 * a stopped runtime, the backend) is worth another attempt.
 */
export type SecretSaveFailure = 'outdated' | 'error'

/** The backend's own code for "this runtime is too old for a secret" (409). */
export function secretSaveFailure(error: unknown): SecretSaveFailure {
  return parseAtlasError(error).code === 'runtime_outdated' ? 'outdated' : 'error'
}
