export type PersonalCredentialProvider =
  'github' | 'linear' | 'gmail' | 'google-drive' | 'google-calendar'

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
