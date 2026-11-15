import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { personalCredentialsChanged } from '../../lib/query/account'

import type {
  PersonalCredential,
  PersonalCredentialDeepLinkPayload,
  PersonalCredentialProvider,
} from '../../types'

const NAMES: Record<PersonalCredentialProvider, string> = {
  github: 'GitHub',
  linear: 'Linear',
  gmail: 'Gmail',
  'google-drive': 'Google Drive',
}

export function nameOf(provider: PersonalCredentialProvider): string {
  return NAMES[provider]
}

export const PERSONAL_CREDENTIALS_SECTION = 'account.personalCredentials'

export const isGoogle = (provider: PersonalCredentialProvider) =>
  provider === 'gmail' || provider === 'google-drive'

/** The credential that applies in this team: Gmail / Google Drive grants are per team. */
export function credentialFor(
  credentials: PersonalCredential[] | null,
  provider: PersonalCredentialProvider,
  teamId: string | undefined,
): PersonalCredential | undefined {
  return credentials?.find(
    (c) => c.provider === provider && (!isGoogle(provider) || c.teamId === teamId),
  )
}

/** The personal entries the Connectors page lists, with the words people search them by. */
export type PersonalConnector = {
  provider: PersonalCredentialProvider
  summary: string
  keywords: string
}

export const PERSONAL_CONNECTORS: PersonalConnector[] = [
  {
    provider: 'github',
    summary: t('Commits, PRs and comments authored by you.'),
    keywords: 'git',
  },
  { provider: 'linear', summary: t('Issues and comments authored by you.'), keywords: '' },
  {
    provider: 'gmail',
    summary: t('Read, draft and send your mail.'),
    keywords: 'google mail email inbox',
  },
  {
    provider: 'google-drive',
    summary: t('Find, read and save your own files.'),
    keywords: 'google docs sheets files',
  },
]

/** Global handler for the claimed nuphos://personal-credential deep link. */
export function announcePersonalCredential({
  provider,
  login,
  error,
}: PersonalCredentialDeepLinkPayload) {
  const name = nameOf(provider)

  if (login) {
    toast.success(t('Connected {name} as {login}', { name, login }))
  } else if (error === 'oauth_not_ready') {
    toast.error(
      t('Couldn’t connect {name}', { name }),
      t('This link expired or was started from another account.'),
    )
  } else {
    toast.error(t('Couldn’t connect {name}', { name }), t('Please try again.'))
  }
  void personalCredentialsChanged()
}

/** The personal entries a search keeps; every term has to match, as in the team catalog. */
export function matchingPersonalConnectors(terms: string[]) {
  return PERSONAL_CONNECTORS.filter(({ provider, summary, keywords }) => {
    const haystack = `${nameOf(provider)} ${summary} ${provider} personal ${keywords}`.toLowerCase()

    return terms.every((term) => haystack.includes(term))
  })
}
