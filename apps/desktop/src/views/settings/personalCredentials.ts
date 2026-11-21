import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { isGoogle } from '../../types'

import { credentialsFor } from './personalAccounts'

import type {
  PersonalCredential,
  PersonalCredentialDeepLinkPayload,
  PersonalCredentialProvider,
} from '../../types'

/** Fired after the main process claims an OAuth grant, so an open section refetches. */
export const PERSONAL_CREDENTIALS_CHANGED = 'personal-credentials:changed'

const NAMES: Record<PersonalCredentialProvider, string> = {
  github: 'GitHub',
  linear: 'Linear',
  gmail: 'Gmail',
  'google-drive': 'Google Drive',
  'google-calendar': 'Google Calendar',
}

export function nameOf(provider: PersonalCredentialProvider): string {
  return NAMES[provider]
}

export const PERSONAL_CREDENTIALS_SECTION = 'account.personalCredentials'

/** Starts signing in to the member's own account in the browser; a failure says why. */
export async function connectPersonalCredential(
  provider: PersonalCredentialProvider,
  teamId: string | undefined,
): Promise<void> {
  try {
    const { authorizeUrl } = await api.atlasStartPersonalCredential(
      provider,
      isGoogle(provider) ? teamId : undefined,
    )

    await api.appOpenExternal(authorizeUrl)
  } catch (err) {
    if (parseAtlasError(err).code === 'personal_credential_not_configured') {
      toast.error(
        t('Could not connect {name}', { name: nameOf(provider) }),
        t('Not configured on this server yet'),
      )
    } else {
      toast.apiError(t('Could not connect {name}', { name: nameOf(provider) }), err)
    }
  }
}

/** The first account that applies in this team. */
export function credentialFor(
  credentials: PersonalCredential[] | null,
  provider: PersonalCredentialProvider,
  teamId: string | undefined,
): PersonalCredential | undefined {
  return credentialsFor(credentials, provider, teamId)[0]
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
  {
    provider: 'google-calendar',
    summary: t('Check your schedule and set up events.'),
    keywords: 'google calendar events meetings schedule',
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
  window.dispatchEvent(new Event(PERSONAL_CREDENTIALS_CHANGED))
}

/** The personal entries a search keeps; every term has to match, as in the team catalog. */
export function matchingPersonalConnectors(terms: string[]) {
  return PERSONAL_CONNECTORS.filter(({ provider, summary, keywords }) => {
    const haystack = `${nameOf(provider)} ${summary} ${provider} personal ${keywords}`.toLowerCase()

    return terms.every((term) => haystack.includes(term))
  })
}
