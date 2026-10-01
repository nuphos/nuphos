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

export type SelectionKey = keyof AgentCredentialSelection

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

function unselectedEntry(provider: string, id: string, label: string): UnselectedCredentialEntry {
  return {
    provider,
    id,
    label,
    selected: false,
    hint:
      `Not enabled for this conversation. Ask the user to tick "${label}" (${provider}) in ` +
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
