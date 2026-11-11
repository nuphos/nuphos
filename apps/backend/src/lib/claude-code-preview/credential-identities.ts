import type { SessionCredentials } from './credential-lister'
import type { AgentCredentialOptions, AgentCredentialSelection } from '@/routes/agent/types'

export function describeCredentialIdentities(
  credentials: SessionCredentials,
  selection: AgentCredentialSelection,
  options: AgentCredentialOptions,
): SessionCredentials {
  const selected = credentials.selected.map((entry) => {
    if (entry.provider !== 'github' && entry.provider !== 'linear') return entry
    const provider = entry.provider
    const personal = options.personalCredentials.find(
      (credential) => credential.provider === provider,
    )

    if (!personal || selection.teamIdentity?.includes(provider)) {
      return { ...entry, identityPreference: { kind: 'team' as const } }
    }

    return {
      ...entry,
      identityPreference: { kind: 'personal' as const, login: personal.login },
    }
  })

  return {
    selected,
    unselected: credentials.unselected,
  }
}
