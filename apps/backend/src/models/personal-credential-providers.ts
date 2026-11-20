// No imports: the API schemas read this list without loading the database.
export const PERSONAL_CREDENTIAL_PROVIDERS = [
  'github',
  'linear',
  'gmail',
  'google-drive',
  'google-calendar',
] as const

export type PersonalCredentialProvider = (typeof PERSONAL_CREDENTIAL_PROVIDERS)[number]
