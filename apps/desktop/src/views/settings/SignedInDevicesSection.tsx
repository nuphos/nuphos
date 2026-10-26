import { useCallback, useEffect, useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { relativeTimeFromNow } from '../../components/agent/panel/textUtils'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SkeletonReveal } from '../../components/SkeletonReveal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import { SectionHeader } from './shared'
import { sessionDevice, sessionPlace, sortSessions } from './signInSessionsPresentation'

import type { SignInSession } from '../../types'

type Load =
  | { state: 'loading' }
  | { state: 'ready'; sessions: SignInSession[] }
  // A sign-in from before sessions: it works, but has no session to manage from.
  | { state: 'signInAgain' }
  // A backend from before sessions has no such route.
  | { state: 'unavailable' }
  | { state: 'failed' }

export function SignedInDevicesSection({ onSignOut }: { onSignOut: () => void }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<SignInSession | 'others' | null>(null)

  const refresh = useCallback(() => {
    void api
      .atlasListSignInSessions()
      .then((sessions) => setLoad({ state: 'ready', sessions: sortSessions(sessions) }))
      .catch((err: unknown) => {
        const { code } = parseAtlasError(err)

        if (code === 'session_required') return setLoad({ state: 'signInAgain' })
        if (code === 'route_not_found') return setLoad({ state: 'unavailable' })
        setLoad({ state: 'failed' })
        toast.apiError('Could not load your signed-in devices', err)
      })
  }, [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)

    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  async function signOut(target: SignInSession | 'others') {
    setBusy(target === 'others' ? 'others' : target.id)
    try {
      if (target === 'others') {
        const revoked = await api.atlasSignOutOtherSessions()

        toast.success(`Signed out ${String(revoked)} other device${revoked === 1 ? '' : 's'}`)
      } else {
        await api.atlasSignOutSession(target.id)
        toast.success(`Signed out ${sessionDevice(target)}`)
      }
    } catch (err) {
      toast.apiError('Could not sign out', err)
    } finally {
      setBusy(null)
      refresh()
    }
  }

  const sessions = load.state === 'ready' ? load.sessions : []
  const others = sessions.filter((s) => !s.current)

  return (
    <div>
      <SectionHeader
        title="Signed-in devices"
        description="Where your account is signed in. Sign out anything you don’t recognize, then change your password."
      />
      {load.state === 'signInAgain' && (
        <div className="rounded-lg border border-zGray-800/70 bg-surface px-4 py-3.5">
          <p className="text-[13px] text-main">Sign in again to manage your devices.</p>
          <p className="mt-1 text-[12.5px] text-tertiary">
            This device signed in before device management existed.
          </p>
          <Button type="button" size="sm" className="mt-3" onClick={onSignOut}>
            Sign out and sign in again
          </Button>
        </div>
      )}
      {load.state === 'unavailable' && (
        <p className="text-[12.5px] text-tertiary">
          Device management isn’t available on this server yet.
        </p>
      )}
      {load.state === 'failed' && (
        <p className="text-[12.5px] text-tertiary">
          Couldn’t load your signed-in devices.{' '}
          <Button type="button" size="sm" variant="secondary" onClick={refresh}>
            Retry
          </Button>
        </p>
      )}
      {(load.state === 'loading' || load.state === 'ready') && (
        <SkeletonReveal
          ready={load.state === 'ready'}
          skeleton={
            <div aria-busy="true" className="space-y-2">
              <div className="h-[60px] rounded-lg bg-zGray-800/40" />
              <div className="h-[60px] rounded-lg bg-zGray-800/40" />
            </div>
          }
        >
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-4 rounded-lg border border-zGray-800/70 bg-surface px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13.5px] font-medium text-main">
                    <span className="truncate">{sessionDevice(session)}</span>
                    {session.current && (
                      <span className="shrink-0 rounded bg-zGray-800/60 px-1.5 py-0.5 text-[11px] font-normal text-secondary">
                        This device
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[12.5px] text-tertiary">
                    {sessionPlace(session)} ·{' '}
                    {session.current
                      ? 'Active now'
                      : `Last active ${relativeTimeFromNow(session.lastUsedAt)}`}
                  </p>
                </div>
                {!session.current && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={() => setConfirming(session)}
                  >
                    Sign out
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
              disabled={busy !== null}
              onClick={() => setConfirming('others')}
            >
              Sign out all other devices
            </Button>
          )}
        </SkeletonReveal>
      )}
      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming === 'others'
            ? 'Sign out all other devices'
            : `Sign out ${confirming ? sessionDevice(confirming) : ''}`
        }
        description={
          confirming === 'others'
            ? 'Every device except this one will need to sign in again.'
            : 'That device will need to sign in again.'
        }
        confirmLabel="Sign out"
        destructive
        onConfirm={() => (confirming ? signOut(confirming) : undefined)}
        onClose={() => setConfirming(null)}
      />
    </div>
  )
}
