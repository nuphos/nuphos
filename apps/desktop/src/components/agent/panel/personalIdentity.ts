import { t } from '../../../i18n/index.ts'

import type { AgentCredentialOptions, AgentCredentialSelection } from '../../../api'
import type { PersonalCredential, PersonalCredentialProvider } from '../../../types'

// Who the agent acts as on the team's binding of GitHub / Linear: the member, or
// the team. Not the member's own credential (personalCredentialIds), which is a
// row of its own. Like every row, it counts toward the N/M badge.
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
    label: t('Team connection acts as you ({login})', { login: credential.login }),
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
 * The member's own GitHub / Linear rows that Select all and the N/M badge count, as
 * drawn: the own credential, and under a team binding also the identity row
 * (ticked = the binding acts as the member).
 */
export function personalRows(options: AgentCredentialOptions, value: AgentCredentialSelection) {
  return (options.personalCredentials ?? []).flatMap(({ provider }) => {
    const own = {
      provider,
      identity: false,
      checked: (value.personalCredentialIds ?? []).includes(provider),
    }
    const bound =
      provider === 'github'
        ? options.githubInstallations.length > 0
        : options.linearWorkspaces.length > 0

    if (!bound) return [own]

    return [
      own,
      { provider, identity: true, checked: !(value.teamIdentity ?? []).includes(provider) },
    ]
  })
}

/**
 * Select all ticks every counted own row; Clear all unticks them and revokes every
 * own credential. Other providers' identity is kept.
 */
export function setAllPersonal(
  value: AgentCredentialSelection,
  rows: ReturnType<typeof personalRows>,
  select: boolean,
): Pick<AgentCredentialSelection, 'teamIdentity' | 'personalCredentialIds'> {
  const bound = rows.filter((row) => row.identity).map((row) => row.provider)
  const others = (value.teamIdentity ?? []).filter((p) => !bound.includes(p as 'github'))

  return {
    teamIdentity: select ? others : [...others, ...bound],
    personalCredentialIds: select
      ? rows.filter((row) => !row.identity).map((row) => row.provider)
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
