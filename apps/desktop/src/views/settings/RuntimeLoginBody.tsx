import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { toast } from '../../components/ui/toast'
import { AGENT_PROVIDER } from '../../types/runtime'

import { BrowserCodeEntry } from './BrowserCodeEntry'
import { RuntimeLoginStep } from './RuntimeLoginStep'
import { loginButtonClasses as buttonClass } from './styles'

import type { RuntimeLogin } from './useRuntimeLogin'
import type { RuntimeLoginStatus, RuntimeInstance } from '../../types/runtime'

function DeviceCode({
  instance,
  login,
  verificationUri,
}: {
  instance: RuntimeInstance
  login: RuntimeLoginStatus
  verificationUri: string | undefined
}) {
  const [copied, setCopied] = useState(false)
  const account = AGENT_PROVIDER[instance.provider].account

  return (
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
      <p className="flex items-center gap-2 text-[13px] text-secondary">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        Waiting for approval…
      </p>
      <p className="text-xs leading-5 text-tertiary">
        We’ll connect the agent automatically after you approve. Keep this window open; leaving it
        cancels sign-in. The code expires in 15 minutes.
      </p>
    </>
  )
}

/** What a team agent's sign-in shows right now; the surrounding dialog or panel owns the actions. */
export function RuntimeLoginBody({
  instance,
  state,
}: {
  instance: RuntimeInstance
  state: RuntimeLogin
}) {
  const { login, error, reachable, awaiting, authorizationUrl, verificationUri, failed } = state

  return (
    <>
      {awaiting && login?.step ? (
        <RuntimeLoginStep
          key={JSON.stringify(login.step)}
          step={login.step}
          submitted={login.codeSubmitted === true}
          onSubmit={state.submitCode}
        />
      ) : authorizationUrl && login ? (
        <BrowserCodeEntry
          provider={instance.provider}
          url={authorizationUrl}
          submitted={login.codeSubmitted === true}
          onSubmit={state.submitCode}
        />
      ) : awaiting && login ? (
        <DeviceCode
          key={state.retry}
          instance={instance}
          login={login}
          verificationUri={verificationUri}
        />
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
    </>
  )
}
