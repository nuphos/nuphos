import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { relativeTimeFromNow } from '../../components/agent/panel/textUtils'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SkeletonReveal } from '../../components/SkeletonReveal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { Tooltip } from '../../components/ui/tooltip'
import { t } from '../../i18n'
import { useSignInSessionsQuery } from '../../lib/query/account'
import { queryKeys } from '../../lib/query/keys'

import { SectionHeader } from './shared'
import {
  sessionDevice,
  sessionLocation,
  sessionPlace,
  sortSessions,
} from './signInSessionsPresentation'

import type { SignInSession } from '../../types'

export function SignedInDevicesSection({ onSignOut }: { onSignOut: () => void }) {
  const listed = useSignInSessionsQuery()
  const [confirming, setConfirming] = useState<SignInSession | 'others' | null>(null)
  const code = listed.error ? parseAtlasError(listed.error).code : undefined
  // A sign-in from before sessions works, but has no session to manage from.
  const signInAgain = code === 'session_required'
  // A backend from before sessions has no such route.
  const unavailable = code === 'route_not_found'
  const failed = listed.isError && !signInAgain && !unavailable
  const ready = listed.data !== undefined && !signInAgain && !unavailable

  useEffect(() => {
    if (failed) toast.apiError(t('Could not load your signed-in devices'), listed.error)
  }, [failed, listed.error])

  const signOut = useMutation({
    mutationFn: async (target: SignInSession | 'others') => {
      if (target !== 'others') {
        await api.atlasSignOutSession(target.id)
        toast.success(t('Signed out {device}', { device: sessionDevice(target) }))

        return
      }
      const revoked = await api.atlasSignOutOtherSessions()

      toast.success(
        revoked === 1
          ? t('Signed out 1 other device')
          : t('Signed out {n} other devices', { n: revoked }),
      )
    },
    onError: (err) => toast.apiError(t('Could not sign out'), err),
    onSettled: (_result, _error, _target, _context, { client }) =>
      client.invalidateQueries({ queryKey: queryKeys.signInSessions() }),
  })
  const busy = signOut.isPending
  const sessions = ready ? sortSessions(listed.data) : []
  const others = sessions.filter((s) => !s.current)

  return (
    <div>
      <SectionHeader
        title={t('Signed-in devices')}
        description={t(
          'Where your account is signed in. Sign out anything you don’t recognize, then change your password.',
        )}
      />
      {signInAgain && (
        <div className="rounded-lg border border-line-control/70 bg-surface px-4 py-3.5">
          <p className="text-[13px] text-main">{t('Sign in again to manage your devices.')}</p>
          <p className="mt-1 text-[12.5px] text-tertiary">
            {t('This device signed in before device management existed.')}
          </p>
          <Button type="button" size="sm" className="mt-3" onClick={onSignOut}>
            {t('Sign out and sign in again')}
          </Button>
        </div>
      )}
      {unavailable && (
        <p className="text-[12.5px] text-tertiary">
          {t('Device management isn’t available on this server yet.')}
        </p>
      )}
      {failed && !ready && (
        <p className="text-[12.5px] text-tertiary">
          {t('Couldn’t load your signed-in devices.')}{' '}
          <Button type="button" size="sm" variant="secondary" onClick={() => void listed.refetch()}>
            {t('Retry')}
          </Button>
        </p>
      )}
      {(listed.isPending || ready) && (
        <SkeletonReveal
          ready={ready}
          skeleton={
            <div aria-busy="true" className="space-y-2">
              <div className="h-[60px] rounded-lg bg-state-selected" />
              <div className="h-[60px] rounded-lg bg-state-selected" />
            </div>
          }
        >
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-4 rounded-lg border border-line-control/70 bg-surface px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13.5px] font-medium text-main">
                    <span className="truncate">{sessionDevice(session)}</span>
                    {session.current && (
                      <span className="shrink-0 rounded bg-state-selected px-1.5 py-0.5 text-[11px] font-normal text-secondary">
                        {t('This device')}
                      </span>
                    )}
                  </div>
                  {/* Device · location · last active. The IP is on hover, where a
                      long IPv6 cannot push the time out of the row. */}
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-tertiary">
                    <Tooltip
                      content={sessionPlace(session)}
                      triggerClassName="min-w-0"
                      disabled={!session.ip}
                    >
                      <span className="min-w-0 truncate">{sessionLocation(session)}</span>
                    </Tooltip>
                    <span className="shrink-0">
                      ·{' '}
                      {session.current
                        ? t('Active now')
                        : t('Last active {when}', {
                            when: relativeTimeFromNow(session.lastUsedAt),
                          })}
                    </span>
                  </p>
                </div>
                {!session.current && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setConfirming(session)}
                  >
                    {t('Sign out')}
                  </Button>
                )}
              </div>
            ))}
          </div>
          {others.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-4"
              disabled={busy}
              onClick={() => setConfirming('others')}
            >
              {t('Sign out all other devices')}
            </Button>
          )}
        </SkeletonReveal>
      )}
      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming === 'others'
            ? t('Sign out all other devices')
            : t('Sign out {device}', { device: confirming ? sessionDevice(confirming) : '' })
        }
        description={
          confirming === 'others'
            ? t('Every device except this one will need to sign in again.')
            : t('That device will need to sign in again.')
        }
        confirmLabel={t('Sign out')}
        destructive
        onConfirm={async () => {
          // The toast says what failed, so the dialog just closes.
          if (confirming) await signOut.mutateAsync(confirming).catch(() => null)
        }}
        onClose={() => setConfirming(null)}
      />
    </div>
  )
}
