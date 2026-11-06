import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { AGENT_PROVIDER } from '../../types/runtime'

import { ApiKeyEntry, ApiKeyLink } from './ApiKeyEntry'
import { signsInWithApiKey } from './apiKeyProviders'
import { BrowserCodeEntry } from './BrowserCodeEntry'
import { RuntimeLoginStep } from './RuntimeLoginStep'

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
        {t('Copy this one-time code, then enter it on the {account} sign-in page.', { account })}
      </p>
      <button
        type="button"
        aria-label={t('Copy sign-in code')}
        onClick={() => {
          void navigator.clipboard.writeText(login.userCode ?? '').then(
            () => setCopied(true),
            () => toast.error(t('Could not copy code')),
          )
        }}
        className="flex w-full items-center justify-between gap-4 rounded-lg border border-line-control bg-state-selected px-4 py-4 text-main hover:bg-state-hover"
      >
        <code className="text-2xl font-semibold tracking-widest">{login.userCode}</code>
        <span className="flex items-center gap-1.5 text-xs text-secondary">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? t('Copied') : t('Copy')}
        </span>
      </button>
      {verificationUri && (
        <Button
          size="md"
          className="w-full"
          nativeButton={false}
          render={<a href={verificationUri} target="_blank" rel="noopener noreferrer" />}
        >
          {t('Open {account}', { account })} <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      )}
      <p className="flex items-center gap-2 text-[13px] text-secondary">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        {t('Waiting for approval…')}
      </p>
      <p className="text-xs leading-5 text-tertiary">
        {t(
          'We’ll connect the runtime automatically after you approve. Keep this window open; leaving it cancels sign-in. The code expires in 15 minutes.',
        )}
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
  const [keyEntry, setKeyEntry] = useState(false)
  // The attempt a key went to; a new attempt starts over.
  const [keyFor, setKeyFor] = useState<string | null>(null)
  const [ignoredFor, setIgnoredFor] = useState<string | null>(null)
  const keySent = login !== null && keyFor === login.attemptId
  const keyIgnored = keySent && ignoredFor === keyFor
  // The account sign-in waits; its own CLI can take an API key in its place.
  const keyable =
    awaiting && login && !login.step && signsInWithApiKey(instance.provider)
      ? instance.provider
      : null

  // A runtime from before API keys ignores one and keeps waiting for its account sign-in.
  useEffect(() => {
    if (!keySent || !awaiting) return
    const timer = setTimeout(() => setIgnoredFor(keyFor), 60_000)

    return () => clearTimeout(timer)
  }, [keySent, awaiting, keyFor])

  if (keyable && (keyEntry || keySent))
    return keyIgnored ? (
      <p className="text-[13px] leading-5 text-error">
        {t(
          'The runtime did not take the key. Update Nuphos on the computer it runs on, then try again.',
        )}
      </p>
    ) : keySent ? (
      <div className="flex items-center gap-3 text-[13px] text-secondary">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        {t('Verifying your sign-in…')}
      </div>
    ) : (
      <ApiKeyEntry
        provider={keyable}
        onBack={() => setKeyEntry(false)}
        onSubmit={async (key) => {
          await state.submitCode(key)
          setKeyFor(login?.attemptId ?? null)
          setKeyEntry(false)
        }}
      />
    )

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
          {login?.error ?? error ?? t('Sign-in was cancelled.')}
        </p>
      ) : (
        <div className="flex items-center gap-3 text-[13px] text-secondary">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          {reachable
            ? t('Preparing secure sign-in…')
            : t(
                'Starting your runtime… You can close this and sign in from its card once it is running.',
              )}
        </div>
      )}
      {keyable && !login?.codeSubmitted && <ApiKeyLink onClick={() => setKeyEntry(true)} />}
      {error && login && !failed && <p className="text-xs text-error">{error}</p>}
    </>
  )
}
