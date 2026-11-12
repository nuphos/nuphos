import { api } from '../api'
import { MfaCodeForm } from '../components/MfaCodeForm'
import { Button } from '../components/ui/button'
import { t } from '../i18n'

import type { UserInfo } from '../types'

/** The last step of a sign-in to an account with two-factor authentication on. */
export function LoginMfaStep({
  mfaToken,
  onLogin,
  onBack,
}: {
  mfaToken: string
  onLogin: (user: UserInfo) => void
  onBack: () => void
}) {
  return (
    <div className="w-full flex flex-col gap-2.5">
      <p className="text-[13.5px] text-secondary leading-relaxed">
        {t('Enter the 6-digit code from your authenticator app.')}
      </p>
      <MfaCodeForm
        submitLabel={t('Verify code')}
        onSubmit={async (code) => onLogin(await api.authMfaVerify(mfaToken, code))}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="self-start titlebar-no-drag"
      >
        {t('Back to sign-in')}
      </Button>
    </div>
  )
}
