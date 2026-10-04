import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { useLocalRuntimeState } from '../../hooks/useLocalRuntimeState'
import { useStableCallback } from '../../hooks/useStableCallback'

/** One sign-in flow for onboarding, settings and conversation recovery. */
export function LocalClaudeSignIn({
  label = 'Sign in with Claude',
  initiallyOpen = false,
  onClosed,
}: {
  label?: string
  initiallyOpen?: boolean
  onClosed?: (connected: boolean) => void
}) {
  const state = useLocalRuntimeState()
  const [open, setOpen] = useState(initiallyOpen)
  const [failed, setFailed] = useState(false)
  const [starting, setStarting] = useState(false)
  const login = state?.claudeLogin
  const failure = failed || login?.state === 'failed'
  const busy = starting || login?.state === 'waiting' || login?.state === 'checking'
  const [attempted, setAttempted] = useState(false)
  const connected = attempted && !starting && login?.state === 'connected'

  const previousLoginState = useRef(login?.state)

  useEffect(() => {
    const justFailed = login?.state === 'failed' && previousLoginState.current !== 'failed'

    previousLoginState.current = login?.state
    if (open && justFailed) {
      toast.error('Claude sign-in failed', login.error ?? 'Please try signing in again.')
    }
  }, [open, login?.state, login?.error])

  const closeFromEscape = useStableCallback(close)

  useEffect(() => {
    if (!open) return
    // Consume Escape before the surrounding onboarding Modal's document listener.
    // Keep the parent mounted even while cancellation waits for the main process.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      void closeFromEscape()
    }

    document.addEventListener('keydown', onKey, true)

    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, closeFromEscape])

  async function start() {
    setOpen(true)
    setFailed(false)
    setStarting(true)
    setAttempted(true)
    try {
      await api.localRuntimeStartClaudeLogin()
    } catch (err) {
      setFailed(true)
      toast.apiError('Could not start Claude sign-in', err)
    } finally {
      setStarting(false)
    }
  }
  async function close() {
    try {
      if (busy) await api.localRuntimeCancelClaudeLogin()
      setOpen(false)
      onClosed?.(connected)
    } catch (err) {
      toast.apiError('Could not cancel Claude sign-in', err)
    }
  }

  return (
    <>
      {!initiallyOpen && (
        <Button
          size="sm"
          onClick={() => {
            setAttempted(login?.state === 'waiting' || login?.state === 'checking')
            setFailed(false)
            setOpen(true)
          }}
        >
          {label}
        </Button>
      )}
      {open && (
        <Modal
          open
          title="Connect Claude on this computer"
          onClose={() => void close()}
          closeOnBackdrop={false}
        >
          <div className="space-y-4 p-5" role="status" aria-live="polite">
            <p className="text-[13px] text-secondary">
              Sign in once for Nuphos on this computer. Your sign-in stays here, separate from
              Claude in your terminal. Restarting Nuphos does not require another sign-in. Signing
              in reconnects your local Claude agent and stops its running conversations.
            </p>
            {connected ? (
              <p className="text-[13px] text-main">
                Claude is connected. Return to your conversation and resend your message.
              </p>
            ) : (
              <>
                <p className="text-[13px] text-secondary">
                  {login?.state === 'checking'
                    ? 'Verifying your sign-in…'
                    : busy
                      ? 'Complete sign-in in your browser, then return here. We will check it automatically.'
                      : 'Open Claude sign-in to connect your account.'}
                </p>
                {login?.url && (
                  <a
                    href={login.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-zViolet-400 underline"
                  >
                    Open Claude sign-in
                  </a>
                )}
              </>
            )}
            <div className="flex gap-2">
              {!busy && !connected && (
                <Button size="sm" onClick={() => void start()}>
                  {failure || login?.state === 'cancelled' ? 'Try again' : 'Open Claude sign-in'}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => void close()}>
                {busy ? 'Cancel sign-in' : 'Done'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
