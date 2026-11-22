import { isGoogle } from '../../types/personal-credentials.ts'

import type { PersonalCredential, PersonalCredentialProvider } from '../../types'

/** Only these keep several accounts side by side; a Google grant is one per team. */
export const MULTI_ACCOUNT_PROVIDERS: readonly PersonalCredentialProvider[] = ['github', 'linear']

/** Every account that applies in this team: Google grants are per team. */
export function credentialsFor(
  credentials: PersonalCredential[] | null,
  provider: PersonalCredentialProvider,
  teamId: string | undefined,
): PersonalCredential[] {
  return (credentials ?? []).filter(
    (c) => c.provider === provider && (!isGoogle(provider) || c.teamId === teamId),
  )
}
