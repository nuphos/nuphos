import { t } from '../../../i18n/index.ts'

import type { AgentCredentialOptions, AgentCredentialSelection } from '../../../api'
import type { PersonalCredential, PersonalCredentialProvider } from '../../../types'

// The member's own GitHub / Linear identity for this conversation. It is not a
// credential the agent gets access to — it decides who the agent acts as on
// the team's binding — so it never counts toward the picker's N/M badge.
export type PersonalIdentityRow = {
  provider: PersonalCredentialProvider
  label: string
  checked: boolean
}

export function personalIdentityRow(
  provider: PersonalCredentialProvider,
  credentials: PersonalCredential[],
  value: AgentCredentialSelection,
): PersonalIdentityRow | null {
  const credential = credentials.find((c) => c.provider === provider)

  // Connecting lives in Settings; the picker only offers an identity you have.
  if (!credential) return null

  return {
    provider,
    label: t('You ({login}) · Personal', { login: credential.login }),
    checked: !(value.teamIdentity ?? []).includes(provider),
  }
}

/** Ticked = act as the member (provider absent from teamIdentity). */
export function setPersonalIdentity(
  value: AgentCredentialSelection,
  provider: PersonalCredentialProvider,
  personal: boolean,
): AgentCredentialSelection {
  const rest = (value.teamIdentity ?? []).filter((p) => p !== provider)
  const teamIdentity = personal ? rest : [...rest, provider]

  return { ...value, teamIdentity }
}

// Identity, not access: carried through normalize/prune untouched, and only
// present when non-empty so selections without it keep their old shape.
export function teamIdentityOf(
  value: Partial<AgentCredentialSelection> | null | undefined,
): Pick<AgentCredentialSelection, 'teamIdentity' | 'personalCredentialIds'> {
  return {
    ...(value?.teamIdentity?.length ? { teamIdentity: [...value.teamIdentity] } : {}),
    ...(value?.personalCredentialIds?.length
      ? { personalCredentialIds: [...value.personalCredentialIds] }
      : {}),
  }
}

/** A pruned selection with `from`'s teamIdentity and own credentials carried over. */
export function keepTeamIdentity(
  pruned: Omit<AgentCredentialSelection, 'teamIdentity' | 'personalCredentialIds'>,
  from: AgentCredentialSelection,
): AgentCredentialSelection {
  return { ...pruned, ...teamIdentityOf(from) }
}

/** The member's own GitHub / Linear credentials for a provider the team has no binding of. */
export function personalOnlyCredentials(options: AgentCredentialOptions) {
  return (options.personalCredentials ?? []).filter((credential) =>
    credential.provider === 'github'
      ? options.githubInstallations.length === 0
      : options.linearWorkspaces.length === 0,
  )
}

/** Ticked = this conversation may use the member's own credential of `provider`. */
export function setPersonalOnly(
  value: AgentCredentialSelection,
  provider: 'github' | 'linear',
  selected: boolean,
): AgentCredentialSelection {
  const rest = (value.personalCredentialIds ?? []).filter((p) => p !== provider)

  return { ...value, personalCredentialIds: selected ? [...rest, provider] : rest }
}
