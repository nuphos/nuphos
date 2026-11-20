import { EMPTY_CREDENTIAL_ACCESS } from './constants.ts'
import {
  allCredentialAccess,
  credentialOptionsLoaded,
  reconcileStoredCredentialAccess,
} from './credentialAccess.ts'
import { TEAM_WIDE_WHEN_UNSET } from './teamWideWhenUnset.ts'

import type { AgentCredentialOptions, AgentCredentialSelection } from '../../../api'

// A conversation, unlike a dashboard panel, runs with what it stored: none of a kind it has
// no list for, except the kinds whose absence means team-wide reach, as the backend's
// `normalizeCredentialAccess` reads it. Those show every one, whether nothing is stored or
// only other kinds are, as `nuphos_ask` stores them (#4034). Before the options load, the
// team-wide kinds cannot be listed yet.
export function storedConversationCredentialAccess(
  stored: Partial<AgentCredentialSelection> | null | undefined,
  options: AgentCredentialOptions,
): AgentCredentialSelection {
  const shown = reconcileStoredCredentialAccess(stored ?? EMPTY_CREDENTIAL_ACCESS, options)
  if (!credentialOptionsLoaded(options)) return shown
  const all = allCredentialAccess(options)
  const unset = TEAM_WIDE_WHEN_UNSET.filter((kind) => stored?.[kind] == null)

  return { ...shown, ...Object.fromEntries(unset.map((kind) => [kind, all[kind]])) }
}
