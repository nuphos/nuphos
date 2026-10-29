import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import type { PersonalCredentialDeepLinkPayload, PersonalCredentialProvider } from '../../types'

/** Fired after the main process claims an OAuth grant, so an open section refetches. */
export const PERSONAL_CREDENTIALS_CHANGED = 'personal-credentials:changed'

const NAMES: Record<PersonalCredentialProvider, string> = {
  github: 'GitHub',
  linear: 'Linear',
  gmail: 'Gmail',
  'google-drive': 'Google Drive',
}

export function nameOf(provider: PersonalCredentialProvider): string {
  return NAMES[provider]
}

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
