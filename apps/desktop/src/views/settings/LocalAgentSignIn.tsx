import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { useLocalRuntimeState } from '../../hooks/useLocalRuntimeState'
import { useStableCallback } from '../../hooks/useStableCallback'

/** One sign-in flow for onboarding, settings and conversation recovery. */
export function LocalAgentSignIn({
  provider = 'claude-code',
  label,
  initiallyOpen = false,
  onClosed,
}: {
  provider?: 'claude-code' | 'codex'
  label?: string
  initiallyOpen?: boolean
  onClosed?: (connected: boolean) => void
}) {
  const state = useLocalRuntimeState()
  const [open, setOpen] = useState(initiallyOpen)
  const [failed, setFailed] = useState(false)
  const [starting, setStarting] = useState(false)
  const codex = provider === 'codex'
  const name = codex ? 'Codex' : 'Claude'
  const login = codex ? state?.codexLogin : state?.claudeLogin
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
      toast.error(`${name} sign-in failed`, login.error ?? 'Please try signing in again.')
    }
  }, [open, login?.state, login?.error, name])

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
      await (codex ? api.localRuntimeStartCodexLogin() : api.localRuntimeStartClaudeLogin())
    } catch (err) {
      setFailed(true)
      toast.apiError(`Could not start ${name} sign-in`, err)
    } finally {
      setStarting(false)
    }
  }
  async function close() {
    try {
      if (busy)
        await (codex ? api.localRuntimeCancelCodexLogin() : api.localRuntimeCancelClaudeLogin())
      setOpen(false)
      onClosed?.(connected)
    } catch (err) {
      toast.apiError(`Could not cancel ${name} sign-in`, err)
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
          {label ?? `Sign in with ${name}`}
        </Button>
      )}
      {open && (
        <Modal
          open
          title={`Connect ${name} on this computer`}
          onClose={() => void close()}
          closeOnBackdrop={false}
        >
          <div className="space-y-4 p-5" role="status" aria-live="polite">
            <p className="text-[13px] text-secondary">
              {connected
                ? `${name} is connected. Your local agent is ready.`
                : login?.state === 'checking'
                  ? 'Verifying your sign-in…'
                  : busy
                    ? 'Finish signing in in your browser. This updates on its own.'
                    : retry
                      ? 'Sign-in did not finish. Try again.'
                      : codex
                        ? 'Sign in with ChatGPT using the one-time code. Device-code login must be enabled in ChatGPT security settings. This updates your terminal Codex login and restarts your local Codex agent.'
                        : 'Nuphos keeps its own Claude sign-in on this computer, separate from Claude in your terminal. Signing in restarts your local Claude agent and stops its running conversations.'}
            </p>
            {busy && login?.userCode && (
              <div className="space-y-2">
                <p className="text-sm text-secondary">
                  Enter this one-time code on the sign-in page:
                </p>
                <code className="block select-all text-xl font-semibold">{login.userCode}</code>
              </div>
            )}
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
                    {retry ? 'Try again' : `Sign in with ${name}`}
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
