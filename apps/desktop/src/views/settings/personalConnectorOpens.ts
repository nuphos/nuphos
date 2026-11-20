import { isGoogle } from '../../types/personal-credentials.ts'

import type { PersonalCredential, PersonalCredentialProvider, TeamGoogleClient } from '../../types'

/** A Google account this team cannot connect yet: it has no OAuth client, nor Composio. */
export function needsTeamGoogleClient(
  provider: PersonalCredentialProvider,
  client: TeamGoogleClient | null,
): boolean {
  return isGoogle(provider) && client?.clientId === null && !client.composio
}

/**
 * What a Connectors row does: Connect starts the account's sign-in in place. A connected account,
 * or a Google one waiting for the team's client, opens Settings, which says what to do.
 */
export function personalConnectorOpens(
  credential: PersonalCredential | undefined,
  provider: PersonalCredentialProvider,
  client: TeamGoogleClient | null,
): 'connect' | 'settings' {
  return credential || needsTeamGoogleClient(provider, client) ? 'settings' : 'connect'
}
