import { AppError } from '@/lib/errors'

import type { PersonalCredential } from '@/models'

/** Several accounts qualify and the call named none: list them, never pick one. */
export const accountRequired = (docs: PersonalCredential[]) =>
  new AppError(
    409,
    'personal_credential_account_required',
    'Several accounts are connected: ask which one to use, then name it with connectionId',
    { accounts: docs.map((doc) => ({ id: doc._id.toHexString(), login: doc.login })) },
  )

/** The account `connectionId` names, or the one allowed account. Several and none named is a 409. */
export function chooseCredential(
  docs: PersonalCredential[],
  connectionId?: string,
): PersonalCredential | null {
  if (connectionId) {
    const named = docs.find((doc) => doc._id.toHexString() === connectionId)

    if (!named) {
      throw new AppError(
        404,
        'personal_credential_account_not_found',
        'No such connected account for this member',
      )
    }

    return named
  }
  if (docs.length > 1) throw accountRequired(docs)

  return docs[0] ?? null
}
