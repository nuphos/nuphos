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
  // A failure from an earlier, unrelated attempt is not this dialog's to report.
  const retry = attempted && failure

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
              {connected
                ? 'Claude is connected. Your local Claude agent is ready.'
                : login?.state === 'checking'
                  ? 'Verifying your sign-in…'
                  : busy
                    ? 'Finish signing in in your browser. This updates on its own.'
                    : retry
                      ? 'Sign-in did not finish. Try again.'
                      : 'Nuphos keeps its own Claude sign-in on this computer, separate from Claude in your terminal. Signing in restarts your local Claude agent and stops its running conversations.'}
            </p>
            {busy && login?.url && (
              <a
                href={login.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[13px] text-zViolet-400 underline"
              >
                Reopen the sign-in page
              </a>
            )}
            <div className="flex gap-2">
              {connected ? (
                <Button size="sm" onClick={() => void close()}>
                  Done
                </Button>
              ) : busy ? (
                <Button size="sm" variant="ghost" onClick={() => void close()}>
                  Cancel sign-in
                </Button>
              ) : (
                <>
                  <Button size="sm" onClick={() => void start()}>
                    {retry ? 'Try again' : 'Sign in with Claude'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void close()}>
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
