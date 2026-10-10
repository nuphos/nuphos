import { useEffect, useState } from 'react'

import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { useStableCallback } from '../../hooks/useStableCallback'
import { isMac } from '../../lib/platform'

import { useLocalAgentLogin } from './useLocalAgentLogin'

/** One sign-in dialog for settings, the agent selector and conversation recovery. */
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
  const [open, setOpen] = useState(initiallyOpen)
  const { name, codex, login, busy, retry, connected, start, cancel, resume } = useLocalAgentLogin(
    provider,
    open,
  )

  const closeFromEscape = useStableCallback(close)

  useEffect(() => {
    if (!open) return
    // Consume Escape before a surrounding Modal's document listener.
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

  async function close() {
    if (!(await cancel())) return
    setOpen(false)
    onClosed?.(connected)
  }

  return (
    <>
      {!initiallyOpen && (
        <Button
          size="sm"
          onClick={() => {
            resume()
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
                        : isMac
                          ? 'Nuphos uses the Claude sign-in from your terminal. Signing in updates that shared login, restarts your local Claude agent and stops its running conversations.'
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
