import { AppError } from '@/lib/errors'

import type { PersonalCredential } from '@/models'

/**
 * Which of a member's accounts a call may use. The conversation's own list (`authorized`)
 * decides; without one only a lone account is usable, so an account connected later is never
 * reached by a selection made before it existed.
 */
export function allowedAccounts(
  docs: PersonalCredential[],
  authorized?: string[],
): PersonalCredential[] {
  if (authorized) return docs.filter((doc) => authorized.includes(doc._id.toHexString()))

  return docs.length === 1 ? docs : []
}

export const notAuthorized = () =>
  new AppError(
    403,
    'personal_credential_account_not_authorized',
    'This account is not authorized for this conversation: the owner selects which accounts it may use',
  )

/** Several accounts qualify and the call named none: list them, never pick one. */
export const accountRequired = (docs: PersonalCredential[]) =>
  new AppError(
    409,
    'personal_credential_account_required',
    'Several accounts are authorized: ask which one to use, then name it with connectionId',
    { accounts: docs.map((doc) => ({ id: doc._id.toHexString(), login: doc.login })) },
  )

/** The account `connectionId` names, or the one allowed account. Several and none named is a 409. */
export function chooseCredential(
  docs: PersonalCredential[],
  connectionId?: string,
  authorized?: string[],
): PersonalCredential | null {
  const allowed = allowedAccounts(docs, authorized)

  if (connectionId) {
    const named = docs.find((doc) => doc._id.toHexString() === connectionId)

    if (!named) {
      throw new AppError(
        404,
        'personal_credential_account_not_found',
        'No such connected account for this member',
      )
    }
    if (!allowed.includes(named)) throw notAuthorized()

    return named
  }
  if (allowed.length > 1) throw accountRequired(allowed)
  if (allowed.length === 0 && docs.length > 0) throw notAuthorized()

  return allowed[0] ?? null
}
