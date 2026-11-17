import { allCredentialAccess } from './credentialAccess.ts'

import type { CredentialSelectorControl } from './credentialSections'

// The credential ids a selection holds, devices and identity aside, keyed by kind.
function credentialIds(value: CredentialSelectorControl['value']): string[] {
  const { deviceIds: _devices, teamIdentity: _team, personalCredentialIds: _own, ...access } = value

  return Object.entries(access).flatMap(([key, ids]) =>
    Array.isArray(ids) ? ids.map((id: string) => `${key}:${id}`) : [],
  )
}

/** Every credential row the picker draws: what Select all ticks. */
export function countTotalCredentials(options: CredentialSelectorControl['options']): number {
  return credentialIds(allCredentialAccess(options)).length
}

/**
 * The ticked credentials. Given the options, only drawn rows count, so it never
 * exceeds countTotalCredentials: both read the same ids.
 */
export function countSelectedCredentials(
  value: CredentialSelectorControl['value'],
  options?: CredentialSelectorControl['options'],
): number {
  const ids = credentialIds(value)

  if (!options) return ids.length

  const drawn = new Set(credentialIds(allCredentialAccess(options)))

  return ids.filter((id) => drawn.has(id)).length
}
