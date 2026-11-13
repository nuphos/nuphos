import { faApple, faGoogle } from '@fortawesome/free-brands-svg-icons'
import { faArrowRight, faKey } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useState } from 'react'

import { api } from '../api'
import { Button } from '../components/ui/button'
import { toast } from '../components/ui/toast'
import { t } from '../i18n'

import type { SocialOption, SocialProvider, UserInfo } from '../types'

const ICONS = { google: faGoogle, apple: faApple, oidc: faKey } as const

/** One button per provider, each straight to that provider's sign-in, then the "or" above email. */
export function LoginSocialButtons({
  onLogin,
  onMfaRequired,
}: {
  onLogin: (user: UserInfo) => void
  /** True when the failure was the account asking for its second factor. */
  onMfaRequired: (error: unknown) => boolean
}) {
  // Only what this server offers: a self-hosted server without social sign-in shows none.
  // 'failed' means the server could not be asked, which is not the same as offering none.
  const [offered, setOffered] = useState<SocialOption[] | 'failed'>([])

  function load() {
    void api.authSocialProviders().then(setOffered, () => setOffered('failed'))
  }

  useEffect(load, [])

  // No in-flight guard: each click re-launches the auth flow so the user can
  // retry freely (e.g. after closing the browser window without finishing).
  async function signIn(provider: SocialProvider) {
    try {
      onLogin(await api.authLogin(provider))
    } catch (e) {
      if (onMfaRequired(e)) return
      toast.apiError(t('Sign-in failed'), e, {
        fallback: t('Check your internet connection and try again.'),
      })
    }
  }

  if (offered !== 'failed' && offered.length === 0) return null

  return (
    <>
      {offered === 'failed' ? (
        <div className="w-full flex items-center justify-between gap-3">
          <span className="text-[13px] text-secondary">{t("Couldn't load sign-in options.")}</span>
          <Button variant="secondary" size="sm" onClick={load} className="titlebar-no-drag">
            {t('Retry')}
          </Button>
        </div>
      ) : (
        <div className="w-full flex flex-col gap-2.5">
          {offered.map((p) => (
            <Button
              key={p.provider}
              onClick={() => void signIn(p.provider)}
              size="lg"
              className="group w-full titlebar-no-drag"
            >
              <span className="flex flex-1 items-center gap-2">
                <FontAwesomeIcon icon={ICONS[p.provider]} />
                {t('Continue with {provider}', { provider: p.name })}
              </span>
              <FontAwesomeIcon
                icon={faArrowRight}
                className="text-[14px] transition-transform duration-200 group-hover:translate-x-1"
              />
            </Button>
          ))}
        </div>
      )}

      <div className="w-full flex items-center gap-3 my-5">
        <div className="h-px flex-1 bg-surface-sunken" />
        <span className="text-[12px] text-secondary">{t('or')}</span>
        <div className="h-px flex-1 bg-surface-sunken" />
      </div>
    </>
  )
}
