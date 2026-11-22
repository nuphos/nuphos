import { isGoogle } from '../../types/personal-credentials.ts'

import type { PersonalCredentialProvider, TeamGoogleClient } from '../../types'

/** A Google account this team cannot connect yet: it has no OAuth client, nor Composio. */
export function needsTeamGoogleClient(
  provider: PersonalCredentialProvider,
  client: TeamGoogleClient | null,
): boolean {
  return isGoogle(provider) && client?.clientId === null && !client.composio
}
