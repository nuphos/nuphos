import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useStableCallback } from '../../hooks/useStableCallback'
import { AGENT_PROVIDER } from '../../types/runtime'

import { BrowserCodeEntry } from './BrowserCodeEntry'
import { authorizeUrl, devicePage } from './runtimeLogin'
import { loginButtonClasses as buttonClass } from './styles'

import type { RuntimeInstance, RuntimeLoginStatus } from '../../types/runtime'

const activeStates = new Set(['starting', 'awaiting_authorization'])

export function RuntimeLoginDialog({
  teamId,
  instance,
  onClose,
}: {
  teamId: string
  instance: RuntimeInstance
  onClose: () => void
}) {
  const [login, setLogin] = useState<RuntimeLoginStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [closing, setClosing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [reachable, setReachable] = useState(false)
  const account = AGENT_PROVIDER[instance.provider].account
  // Reuse the start request across StrictMode's effect replay: every start replaces the
  // agent's previous sign-in.
  const request = useRef<Promise<RuntimeLoginStatus> | null>(null)
  const complete = useStableCallback(() => {
    window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    toast.success(`${account} connected`, `${instance.label} is now signed in.`)
    onClose()
  })

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const receive = (status: RuntimeLoginStatus) => {
      if (stopped) return
      setLogin(status)
      setError(null)
      if (status.state === 'connected') {
        stopped = true
        complete()
      } else if (activeStates.has(status.state)) timer = setTimeout(poll, 2_000)
    }
    const poll = () => {
      void api.atlasGetRuntimeLogin(teamId, instance.id).then(receive, () => {
        if (stopped) return
        setError('Could not check sign-in status. Retrying…')
        timer = setTimeout(poll, 3_000)
      })
    }

    const start = () => {
      setReachable(true)
      request.current ??= api.atlasStartRuntimeLogin(teamId, instance.id)
      void request.current.then(receive, (cause) => {
        if (!stopped) {
          setError('Could not start sign-in. Please try again.')
          toast.apiError('Could not start sign-in', cause)
        }
      })
    }
    // A just-created agent is still starting; sign-in needs it to answer first.
    const whenReachable = () => {
      void api.atlasGetRuntimeInstanceStatus(teamId, instance.id).then(
        (status) => {
          if (stopped) return
          if (status.online) start()
          else timer = setTimeout(whenReachable, 2_000)
        },
        () => {
          if (!stopped) timer = setTimeout(whenReachable, 3_000)
        },
      )
    }

    if (request.current) start()
    else whenReachable()

    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [teamId, instance.id, retry, complete])

  async function close() {
    if (closing) return
    setClosing(true)
    try {
      // A start still in flight has an attempt too; it must not outlive the dialog.
      const current = login ?? (await request.current?.catch(() => null))

      if (current && activeStates.has(current.state))
        await api.atlasCancelRuntimeLogin(teamId, instance.id, current.attemptId)
      onClose()
    } catch (cause) {
      toast.apiError('Could not cancel sign-in', cause)
    } finally {
      setClosing(false)
    }
  }
  function restart() {
    request.current = null
    setReachable(false)
    setLogin(null)
    setError(null)
    setCopied(false)
    setRetry((value) => value + 1)
  }
  const awaiting = login?.state === 'awaiting_authorization'
  const authorizationUrl = awaiting
    ? authorizeUrl(instance.provider, login.authorizationUrl)
    : undefined
  const verificationUri = awaiting
    ? devicePage(instance.provider, login.verificationUri)
    : undefined
  const failed =
    login?.state === 'failed' || login?.state === 'cancelled' || (!login && Boolean(error))

  return (
    <Modal
      open
      onClose={onClose}
      title={`Sign in with ${account}`}
      description={instance.label}
      closeOnBackdrop={false}
    >
      <div className="space-y-5 p-5" role="status" aria-live="polite">
        {authorizationUrl ? (
          <BrowserCodeEntry
            provider={instance.provider}
            url={authorizationUrl}
            submitted={login?.codeSubmitted === true}
            onSubmit={async (code) => {
              if (login)
                setLogin(
                  await api.atlasSubmitRuntimeLoginCode(teamId, instance.id, login.attemptId, code),
                )
            }}
          />
        ) : awaiting ? (
          <>
            <p className="text-[13px] leading-5 text-secondary">
              Copy this one-time code, then enter it on the {account} sign-in page.
            </p>
            <button
              type="button"
              aria-label="Copy sign-in code"
              onClick={() => {
                void navigator.clipboard.writeText(login.userCode ?? '').then(
                  () => setCopied(true),
                  () => toast.error('Could not copy code'),
                )
              }}
              className="flex w-full items-center justify-between gap-4 rounded-lg border border-zGray-700 bg-zGray-800/40 px-4 py-4 text-main hover:bg-zGray-800/70"
            >
              <code className="text-2xl font-semibold tracking-widest">{login.userCode}</code>
              <span className="flex items-center gap-1.5 text-xs text-secondary">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </span>
            </button>
            {verificationUri && (
              <a
                href={verificationUri}
                target="_blank"
                rel="noopener noreferrer"
                className={`${buttonClass} w-full`}
              >
                Open {account} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <p className="text-xs leading-5 text-tertiary">
              We’ll connect the agent automatically after you approve, even if you close this
              window. The code expires in 15 minutes.
            </p>
          </>
        ) : failed ? (
          <p className="text-[13px] leading-5 text-error">
            {login?.error ?? error ?? 'Sign-in was cancelled.'}
          </p>
        ) : (
          <div className="flex items-center gap-3 text-[13px] text-secondary">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            {reachable
              ? 'Preparing secure sign-in…'
              : 'Starting your agent… You can close this and sign in from its card once it is running.'}
          </div>
        )}
        {error && login && !failed && <p className="text-xs text-error">{error}</p>}
        <div className="flex items-center gap-3">
          {failed && (
            <button type="button" onClick={restart} className={buttonClass}>
              Try again
            </button>
          )}
          <button
            type="button"
            disabled={closing}
            onClick={() => void close()}
            className="rounded-md px-3 py-2 text-[13px] text-secondary hover:bg-zGray-800/60 disabled:opacity-50"
          >
            {failed || !login ? 'Close' : 'Cancel sign-in'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
