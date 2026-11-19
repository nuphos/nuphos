import { api } from '../../../api.ts'

import { credentialOptionsLoaded, normalizeCredentialOptions } from './credentialAccess.ts'

import type { AgentCredentialOptions } from '../../../api.ts'

/**
 * The team's options to read an opening conversation's selection against. Read
 * against options not loaded yet, its team-wide kinds would show off, the tab
 * would keep that, and the next change in its picker would save it. A failed
 * load keeps them as they are.
 */
export async function loadedCredentialOptions(
  teamId: string | undefined,
  options: AgentCredentialOptions,
): Promise<AgentCredentialOptions> {
  if (credentialOptionsLoaded(options)) return options

  return api.agentGetCredentialOptions(teamId).then(normalizeCredentialOptions, () => options)
}
