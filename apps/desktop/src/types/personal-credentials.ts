/** Google grants are per team and have no team binding to act as the member. */
export const GOOGLE_PROVIDERS = ['gmail', 'google-drive', 'google-calendar'] as const

/** Every Personal Credential, as `personalCredentialIds` and a question's `credentials` name it. */
export const PERSONAL_CREDENTIAL_PROVIDERS = ['github', 'linear', ...GOOGLE_PROVIDERS] as const

export type PersonalCredentialProvider = (typeof PERSONAL_CREDENTIAL_PROVIDERS)[number]

export const isGoogle = (provider: PersonalCredentialProvider) =>
  (GOOGLE_PROVIDERS as readonly string[]).includes(provider)

export type PersonalCredential = {
  /** The connection's own id: a member can connect several accounts of one provider. */
  id: string
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
