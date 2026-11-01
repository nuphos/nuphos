import { faApple, faGoogle } from '@fortawesome/free-brands-svg-icons'
import { faArrowRight } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useEffect, useState } from 'react'

import { api } from '../api'
import { Button } from '../components/ui/button'
import { toast } from '../components/ui/toast'
import { t } from '../i18n'

import type { SocialProvider, UserInfo } from '../types'

const PROVIDERS = [
  { provider: 'google', label: 'Google', icon: faGoogle },
  { provider: 'apple', label: 'Apple', icon: faApple },
] as const

/** One button per provider, each straight to that provider's sign-in. */
export function LoginSocialButtons({ onLogin }: { onLogin: (user: UserInfo) => void }) {
  // Google is always offered: servers without social sign-in still have the landing page.
  const [offered, setOffered] = useState<SocialProvider[]>(['google'])

  useEffect(() => {
    void api.authSocialProviders().then((providers) => setOffered(['google', ...providers]))
  }, [])

  // No in-flight guard: each click re-launches the auth flow so the user can
  // retry freely (e.g. after closing the browser window without finishing).
  async function signIn(provider: SocialProvider) {
    try {
      onLogin(await api.authLogin(provider))
    } catch (e) {
      toast.apiError(t('Sign-in failed'), e, {
        fallback: t('Check your internet connection and try again.'),
      })
    }
  }

  return (
    <div className="w-full flex flex-col gap-2.5">
      {PROVIDERS.filter((p) => offered.includes(p.provider)).map((p) => (
        <Button
          key={p.provider}
          onClick={() => void signIn(p.provider)}
          size="lg"
          className="group w-full titlebar-no-drag"
        >
          <span className="flex flex-1 items-center gap-2">
            <FontAwesomeIcon icon={p.icon} />
            {t('Continue with {provider}', { provider: p.label })}
          </span>
          <FontAwesomeIcon
            icon={faArrowRight}
            className="text-[14px] transition-transform duration-200 group-hover:translate-x-1"
          />
        </Button>
      ))}
    </div>
  )
}
