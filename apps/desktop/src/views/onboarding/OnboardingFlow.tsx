import { Loader2, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { requestAddAccount } from '../../app/accounts'
import { t } from '../../i18n'

import { AIConsentStep } from './AIConsentStep'
import { CloudTour } from './tour/CloudTour'

import type { OnboardingFlowProps } from './flow/shared'

export type { OnboardingFlowProps } from './flow/shared'

/**
 * The iOS tour, a word on the free computer, then the first Bot, always in a
 * team of the user's own. Invitations and teams on the user's email domain
 * stay reachable from the app.
 */
export function OnboardingFlow({
  dismissable,
  onClose,
  onCreateWorkspace,
  onLogout,
  onFinish,
}: OnboardingFlowProps) {
  const consent = useAIConsent()

  // Dev-forced sessions keep an invisible Esc escape hatch.
  useEffect(() => {
    if (!dismissable) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [dismissable, onClose])

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto sidebar-surface px-6 pb-12 pt-14 text-main">
      <div className="titlebar-drag absolute inset-x-0 top-0 h-11" aria-hidden="true" />
      {consent.state !== 'accepted' ? (
        <div className="m-auto w-full">
          {consent.state === 'needed' ? (
            <AIConsentStep onAccepted={consent.accept} onLogout={onLogout} />
          ) : (
            <div className="flex flex-col items-center gap-3">
              {consent.state === 'failed' ? (
                <>
                  <p className="max-w-sm text-center text-[13px] text-secondary">{consent.error}</p>
                  <button
                    type="button"
                    onClick={consent.load}
                    className="rounded-md bg-state-hover px-3 py-1.5 text-[13px] text-main hover:bg-state-selected"
                  >
                    {t('Retry loading consent')}
                  </button>
                </>
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-tertiary" />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="m-auto w-full">
          <CloudTour onCreateWorkspace={onCreateWorkspace} onFinish={onFinish} />
        </div>
      )}
      {onLogout && (
        // As on iOS: back to sign-in still signed in, where this account can continue.
        <button
          type="button"
          onClick={() => requestAddAccount({ switching: true })}
          className="titlebar-no-drag fixed bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-tertiary transition-colors hover:bg-state-hover hover:text-secondary"
        >
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('Switch account')}
        </button>
      )}
    </div>
  )
}

/** Whether the account agreed to the AI notice this build shows; asked once per sign-in. */
function useAIConsent() {
  const [state, setState] = useState<'loading' | 'needed' | 'accepted' | 'failed'>('loading')
  const [error, setError] = useState('')

  const ask = () =>
    api.authAIConsent().then(
      (answer) => setState(answer.accepted ? 'accepted' : 'needed'),
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setState('failed')
      },
    )
  const load = () => {
    setState('loading')
    void ask()
  }

  useEffect(() => {
    void ask()
  }, [])

  return { state, error, load, accept: () => setState('accepted') }
}
