import { EMPTY_CREDENTIAL_ACCESS } from './constants.ts'
import {
  allCredentialAccess,
  credentialOptionsLoaded,
  emptyCredentialAccess,
  reconcileStoredCredentialAccess,
} from './credentialAccess.ts'
import { TEAM_WIDE_WHEN_UNSET } from './teamWideWhenUnset.ts'

import type { AgentCredentialOptions, AgentCredentialSelection } from '../../../api'

// A conversation, unlike a dashboard panel, runs with nothing chosen when it has
// nothing stored: none of the kinds the user opts into, and team-wide reach for
// the kinds whose absence means that, as the backend's `normalizeCredentialAccess` reads it.
// Before the options load, the team-wide kinds cannot be listed yet.
export function storedConversationCredentialAccess(
  stored: Partial<AgentCredentialSelection> | null | undefined,
  options: AgentCredentialOptions,
): AgentCredentialSelection {
  if (stored || !credentialOptionsLoaded(options))
    return reconcileStoredCredentialAccess(stored ?? EMPTY_CREDENTIAL_ACCESS, options)
  const all = allCredentialAccess(options)

  return {
    ...emptyCredentialAccess(),
    ...Object.fromEntries(TEAM_WIDE_WHEN_UNSET.map((kind) => [kind, all[kind]])),
  }
}
