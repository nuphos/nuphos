import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { MfaCodeDialog } from '../../components/MfaCodeDialog'
import { SkeletonReveal } from '../../components/SkeletonReveal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { formatDate } from '../members/memberRows'

import { SectionHeader } from './shared'
import { TotpSetup } from './TotpSetup'

import type { MfaSetup, MfaStatus } from '../../types'

type View =
  | { state: 'loading' }
  | { state: 'ready'; status: MfaStatus }
  | { state: 'setup'; setup: MfaSetup }
  /** Shown once, right after turning it on or replacing them. */
  | { state: 'codes'; codes: string[] }
  // Turning it on takes a recent sign-in, so a stolen session cannot.
  | { state: 'signInAgain' }
  // A backend from before two-factor authentication has no such route.
  | { state: 'unavailable' }
  | { state: 'failed' }

const card = 'rounded-lg border border-line-control/70 bg-surface px-4 py-3.5'

export function TwoFactorSection({ onSignOut }: { onSignOut: () => void }) {
  const [view, setView] = useState<View>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<'disable' | 'codes' | null>(null)

  const refresh = useCallback(() => {
    void api
      .atlasGetMfaStatus()
      .then((status) => setView({ state: 'ready', status }))
      .catch((err: unknown) => {
        const { code: errorCode } = parseAtlasError(err)

        if (errorCode === 'route_not_found') return setView({ state: 'unavailable' })
        if (errorCode === 'session_required') return setView({ state: 'signInAgain' })
        setView({ state: 'failed' })
        toast.apiError(t('Could not load two-factor authentication'), err)
      })
  }, [])

  useEffect(refresh, [refresh])

  async function startSetup() {
    setBusy(true)
    try {
      setView({ state: 'setup', setup: await api.atlasStartMfaSetup() })
    } catch (err) {
      const { code: errorCode } = parseAtlasError(err)

      if (errorCode === 'reauth_required' || errorCode === 'session_required') {
        setView({ state: 'signInAgain' })
      } else {
        toast.apiError(t('Could not start setting up two-factor authentication'), err)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <SectionHeader
        title={t('Two-factor authentication')}
        description={t(
          'Ask for a code from an authenticator app each time you sign in, so a stolen password or email is not enough.',
        )}
      />
      {view.state === 'signInAgain' && (
        <div className={card}>
          <p className="text-[13px] text-main">
            {t('Sign in again to turn on two-factor authentication.')}
          </p>
          <p className="mt-1 text-[12.5px] text-tertiary">
            {t('For your security, this needs a sign-in from the last 10 minutes.')}
          </p>
          <Button type="button" size="sm" className="mt-3" onClick={onSignOut}>
            {t('Sign out and sign in again')}
          </Button>
        </div>
      )}
      {view.state === 'unavailable' && (
        <p className="text-[12.5px] text-tertiary">
          {t('Two-factor authentication isn’t available on this server yet.')}
        </p>
      )}
      {view.state === 'failed' && (
        <p className="text-[12.5px] text-tertiary">
          {t('Couldn’t load two-factor authentication.')}{' '}
          <Button type="button" size="sm" variant="secondary" onClick={refresh}>
            {t('Retry')}
          </Button>
        </p>
      )}
      {(view.state === 'loading' || view.state === 'ready') && (
        <SkeletonReveal
          ready={view.state === 'ready'}
          skeleton={<div aria-busy="true" className="h-[74px] rounded-lg bg-state-selected" />}
        >
          {view.state === 'ready' && (
            <div className={`${card} flex items-center gap-4`}>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-main">
                  {view.status.enabled ? t('On') : t('Off')}
                </p>
                <p className="mt-0.5 text-[12.5px] text-tertiary">
                  {view.status.enabled
                    ? t('Since {date} · {n} recovery codes left', {
                        date: formatDate(view.status.enabledAt ?? ''),
                        n: view.status.recoveryCodesRemaining,
                      })
                    : t('Sign-in asks only for your email, password or Google account.')}
                </p>
              </div>
              {view.status.enabled ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirming('codes')}
                  >
                    {t('New recovery codes')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirming('disable')}
                  >
                    {t('Turn off')}
                  </Button>
                </>
              ) : (
                <Button type="button" size="sm" disabled={busy} onClick={() => void startSetup()}>
                  {t('Turn on')}
                </Button>
              )}
            </div>
          )}
        </SkeletonReveal>
      )}
      {view.state === 'setup' && (
        <TotpSetup
          setup={view.setup}
          onEnabled={(codes) => setView({ state: 'codes', codes })}
          onCancel={refresh}
        />
      )}
      {view.state === 'codes' && <RecoveryCodes codes={view.codes} onDone={refresh} />}
      <MfaCodeDialog
        open={confirming !== null}
        title={
          confirming === 'disable'
            ? t('Turn off two-factor authentication')
            : t('Replace your recovery codes')
        }
        description={
          confirming === 'disable'
            ? t('Sign-in will no longer ask for a code. Enter one to confirm.')
            : t('Your current recovery codes will stop working. Enter a code to confirm.')
        }
        submitLabel={confirming === 'disable' ? t('Turn off') : t('Replace codes')}
        onSubmit={async (value) => {
          if (confirming === 'disable') {
            await api.atlasDisableMfa(value)
            toast.success(t('Two-factor authentication is off'))
            refresh()
          } else {
            setView({ state: 'codes', codes: await api.atlasNewMfaRecoveryCodes(value) })
          }
          setConfirming(null)
        }}
        onClose={() => setConfirming(null)}
      />
    </div>
  )
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className={card}>
      <p className="text-[13.5px] font-medium text-main">{t('Save your recovery codes')}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-tertiary">
        {t('If you lose your authenticator, each code signs you in once. They are shown only now.')}
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[13px] text-main">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard
              .writeText(codes.join('\n'))
              .then(() => toast.success(t('Recovery codes copied')))
          }}
        >
          {t('Copy codes')}
        </Button>
        <Button type="button" size="sm" onClick={onDone}>
          {t('I saved them')}
        </Button>
      </div>
    </div>
  )
}
