export type PersonalCredentialProvider =
  'github' | 'linear' | 'gmail' | 'google-drive' | 'google-calendar'

/** Google grants are per team and have no team binding to act as the member. */
export const GOOGLE_PROVIDERS = ['gmail', 'google-drive', 'google-calendar'] as const

export const isGoogle = (provider: PersonalCredentialProvider) =>
  (GOOGLE_PROVIDERS as readonly string[]).includes(provider)

export type PersonalCredential = {
  provider: PersonalCredentialProvider
  login: string
  workspaceName: string | null
  /** Gmail / Google Drive / Google Calendar: the team whose OAuth client issued the grant. */
  teamId?: string | null
  connectedAt: string
}

/** Outcome of a nuphos://personal-credential deep link, claimed by the main process. */
export type PersonalCredentialDeepLinkPayload = {
  provider: PersonalCredentialProvider
  login?: string
  error?: string
}
