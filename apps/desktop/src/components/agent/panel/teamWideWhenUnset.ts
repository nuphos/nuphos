/**
 * The kinds a conversation with nothing stored reaches team-wide: the backend's
 * `normalizeCredentialAccess` keeps them absent, and absent means every one. A
 * backend test checks this list against it.
 */
export const TEAM_WIDE_WHEN_UNSET = [
  'githubInstallationIds',
  'gitlabBindingIds',
  'grafanaInstanceIds',
  'sonarqubeIntegrationIds',
  'notionIntegrationIds',
  'upstashAccountIds',
  'cloudflareAccountIds',
  'instaboxAccountIds',
  'personalCredentialIds',
] as const
