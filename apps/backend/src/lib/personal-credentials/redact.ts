/**
 * Only the owner of a credential selection sees which of their own personal
 * accounts it names. Everyone else gets how many, so the ids never leave the
 * owner's responses.
 */
export function redactPersonalAccounts<T extends object>(holder: T, isOwner: boolean): T {
  const access = (holder as { credentialAccess?: unknown }).credentialAccess as
    Record<string, unknown> | null | undefined

  if (isOwner || !access || !Array.isArray(access.personalConnectionIds)) return holder
  const { personalConnectionIds, ...rest } = access

  return {
    ...holder,
    credentialAccess: {
      ...rest,
      personalAccountCount: (personalConnectionIds as unknown[]).length,
    },
  }
}
