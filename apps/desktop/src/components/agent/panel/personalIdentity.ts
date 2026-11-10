import { t } from '../../../i18n/index.ts'

import type { AgentCredentialOptions, AgentCredentialSelection } from '../../../api'
import type { PersonalCredential, PersonalCredentialProvider } from '../../../types'

// The member's own GitHub / Linear identity for this conversation: who the agent
// acts as on the team's binding. Like every row, it counts toward the N/M badge.
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

// Identity, not access: carried through normalize/prune untouched. An empty list
// is kept, not dropped: the backend reads a missing key as "keep what is stored".
export function teamIdentityOf(
  value: Partial<AgentCredentialSelection> | null | undefined,
): Pick<AgentCredentialSelection, 'teamIdentity' | 'personalCredentialIds'> {
  return {
    ...(value?.teamIdentity ? { teamIdentity: [...value.teamIdentity] } : {}),
    ...(value?.personalCredentialIds
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

/**
 * The member's own GitHub / Linear rows, each counted like a credential: under a team binding
 * it is the identity row (ticked = act as the member), without one the credential itself.
 */
export function personalRows(options: AgentCredentialOptions, value: AgentCredentialSelection) {
  return (options.personalCredentials ?? []).map(({ provider, login }) => {
    const bound =
      provider === 'github'
        ? options.githubInstallations.length > 0
        : options.linearWorkspaces.length > 0
    const checked = bound
      ? !(value.teamIdentity ?? []).includes(provider)
      : (value.personalCredentialIds ?? []).includes(provider)

    return { provider, login, bound, checked }
  })
}

/** Select all ticks every own row, Clear all unticks them; other providers' identity is kept. */
export function setAllPersonal(
  value: AgentCredentialSelection,
  rows: ReturnType<typeof personalRows>,
  select: boolean,
): Pick<AgentCredentialSelection, 'teamIdentity' | 'personalCredentialIds'> {
  const bound = rows.filter((row) => row.bound).map((row) => row.provider)
  const others = (value.teamIdentity ?? []).filter((p) => !bound.includes(p as 'github'))
  const teamIdentity = select ? others : [...others, ...bound]

  return {
    teamIdentity,
    personalCredentialIds: select
      ? rows.filter((row) => !row.bound).map((row) => row.provider)
      : [],
  }
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
