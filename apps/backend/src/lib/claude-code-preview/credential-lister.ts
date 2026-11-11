import { isConnectableProvider } from '@/lib/agent/tools-skilled/decision-tools'

import { vendedAccountHint } from './credential-hints'

import type { AgentCredentialOptions, AgentCredentialSelection } from '@/routes/agent/types'

export type ClaudeCodeCredentialEntry = {
  provider: string
  id: string
  label: string
  /** Suffix under /teams/:teamId (and the legacy session mount) that vends it. */
  credentialPath?: string
  /** How to use a selected resource that has no raw value to vend. */
  usage?: string
  /** How to load a vended credential into the sandbox with its builtin skill. */
  hint?: string
  /** kubeconfig context of a selected cluster, kept out of `usage` so it is never shell text. */
  kubeContext?: string
  /** Selected identity preference; the handout's actor confirms the effective identity. */
  identityPreference?: { kind: 'personal'; login: string } | { kind: 'team' }
}

/** A credential the actor may use that this conversation has not selected; never vended. */
export type UnselectedCredentialEntry = {
  provider: string
  id: string
  label: string
  selected: false
  hint: string
}

export type SessionCredentials = {
  selected: ClaudeCodeCredentialEntry[]
  unselected: UnselectedCredentialEntry[]
}

export type EntryDetails = Omit<ClaudeCodeCredentialEntry, 'provider' | 'id'>

// teamIdentity chooses who a credential acts as; it is not a credential to list.
export type SelectionKey = Exclude<keyof AgentCredentialSelection, 'teamIdentity'>

export type Lister = (
  selectedIds: string[] | undefined,
  options: AgentCredentialOptions,
) => SessionCredentials

type ListerSpec<T> = {
  provider: string
  available: (options: AgentCredentialOptions) => T[]
  idOf: (item: T) => string
  details: (item: T, id: string) => EntryDetails
  /** The connector treats an absent selection as team-wide reach. */
  unsetMeansAll?: boolean
}

export function lister<T>(spec: ListerSpec<T>): Lister {
  return (selectedIds, options) => {
    const items = spec.available(options)
    const chosen = new Set(selectedIds ?? (spec.unsetMeansAll ? items.map(spec.idOf) : []))
    const result: SessionCredentials = { selected: [], unselected: [] }

    for (const item of items) {
      const id = spec.idOf(item)
      const details = spec.details(item, id)

      if (chosen.has(id)) result.selected.push({ provider: spec.provider, id, ...details })
      else result.unselected.push(unselectedEntry(spec.provider, id, details.label))
    }

    return result
  }
}

// The name request_user_decision's `providers` takes for an entry, when it takes one.
function requestableAs(provider: string, id: string): string | undefined {
  const name = provider === 'personal' ? id : provider === 'onprem' ? 'onprem-k8s' : provider

  return isConnectableProvider(name) ? name : undefined
}

function unselectedEntry(provider: string, id: string, label: string): UnselectedCredentialEntry {
  const requestable = requestableAs(provider, id)
  // The member's own credential is asked for exactly: `providers` is answered by any access.
  const ask =
    provider === 'personal'
      ? `credentials [{"provider": "personal", "id": "${id}"}]`
      : `providers ["${requestable ?? ''}"]`
  const access =
    provider === 'personal'
      ? 'Standalone personal token access is not enabled for this conversation. This says ' +
        'nothing about the acting identity on a selected team binding; see its identityPreference. '
      : 'Not enabled for this conversation. '

  return {
    provider,
    id,
    label,
    selected: false,
    hint: requestable
      ? access +
        'When the task needs it, call request_user_decision ' +
        `with category "integration" and ${ask}, naming "${label}" in the ` +
        'question. Never ask for it in a free-text question: selecting it answers this one and ' +
        'resumes you.'
      : access +
        `Ask the user to tick "${label}" (${provider}) in ` +
        "this conversation's credential picker, then call list_credentials again.",
  }
}

export function vendedAccount(
  provider: string,
  collection: string,
  available: (options: AgentCredentialOptions) => { accountId: string; label: string }[],
): Lister {
  return lister({
    provider,
    available,
    idOf: (account) => account.accountId,
    details: (account, id) => ({
      label: account.label,
      credentialPath: `${collection}/${id}/credentials`,
      hint: vendedAccountHint(provider, id),
    }),
  })
}

export function viaSkill(label: string, skill: string): EntryDetails {
  return { label, usage: `No raw value to fetch; use the ${skill} skill with this id.` }
}

export function viaTeamApi(label: string, path: string): EntryDetails {
  return {
    label,
    usage: `No raw value to fetch; call ${path} under $NUPHOS_BACKEND_URL/teams/$TEAM with $NUPHOS_TOKEN.`,
  }
}

export const deviceLister: Lister = lister<AgentCredentialOptions['devices'][number]>({
  provider: 'device',
  available: (o) => o.devices,
  idOf: (d) => d.deviceId,
  details: (d, id) => ({
    label: `${d.label} (${d.platform})`,
    usage: d.available
      ? `Authorized for this conversation; any participant who may reply can request local_exec on device=${id}. No separate owner confirmation is needed.`
      : 'Selected, but offline or with local exec turned off; local_exec cannot reach it until Nuphos Desktop is open on it with local exec allowed.',
  }),
})
