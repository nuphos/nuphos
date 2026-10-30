import { useEffect, useState } from 'react'

import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { useStableCallback } from '../../hooks/useStableCallback'
import { t } from '../../i18n'
import { isMac } from '../../lib/platform'

import { ClaudeSignInCode } from './ClaudeSignInCode'
import { useLocalAgentLogin } from './useLocalAgentLogin'

import type { CliLoginProvider } from '../../api'

/** One sign-in dialog for settings, the agent selector and conversation recovery. */
export function LocalAgentSignIn({
  provider = 'claude-code',
  label,
  initiallyOpen = false,
  onClosed,
}: {
  provider?: CliLoginProvider
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
          {label ?? t('Sign in with {name}', { name })}
        </Button>
      )}
      {open && (
        <Modal
          open
          title={t('Connect {name} on this computer', { name })}
          onClose={() => void close()}
          closeOnBackdrop={false}
        >
          <div className="space-y-4 p-5" role="status" aria-live="polite">
            <p className="text-[13px] text-secondary">
              {connected
                ? t('{name} is connected. Your local runtime is ready.', { name })
                : login?.state === 'checking'
                  ? t('Verifying your sign-in…')
                  : busy
                    ? t('Finish signing in in your browser. This updates on its own.')
                    : retry
                      ? t('Sign-in did not finish. Try again.')
                      : codex
                        ? t(
                            'Sign in with ChatGPT using the one-time code. Device-code login must be enabled in ChatGPT security settings. This updates your terminal Codex login and restarts your local Codex runtime.',
                          )
                        : isMac
                          ? t(
                              'Nuphos uses the Claude sign-in from your terminal. Signing in updates that shared login, restarts your local Claude runtime and stops its running agents.',
                            )
                          : t(
                              'Nuphos keeps its own Claude sign-in on this computer, separate from Claude in your terminal. Signing in restarts your local Claude runtime and stops its running agents.',
                            )}
            </p>
            {busy && login?.userCode && (
              <div className="space-y-2">
                <p className="text-sm text-secondary">
                  {t('Enter this one-time code on the sign-in page:')}
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
                {t('Open the sign-in page')}
              </a>
            )}
            {busy && !codex && login?.url && <ClaudeSignInCode key={login.url} />}
            <div className="flex gap-2">
              {connected ? (
                <Button size="sm" onClick={() => void close()}>
                  {t('Done')}
                </Button>
              ) : busy ? (
                <Button size="sm" variant="ghost" onClick={() => void close()}>
                  {t('Cancel sign-in')}
                </Button>
              ) : (
                <>
                  <Button size="sm" onClick={() => void start()}>
                    {retry ? t('Try again') : t('Sign in with {name}', { name })}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void close()}>
                    {t('Cancel')}
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
