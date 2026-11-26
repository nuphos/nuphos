import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { agentProvider } from '../../types/runtime'

import { ApiKeyEntry, KeyRejected, MethodSwitch, Note, RemoveKey } from './ApiKeyEntry'
import { signsInWithApiKey } from './apiKeyProviders'
import { BrowserCodeEntry } from './BrowserCodeEntry'
import { AnsweredRows } from './AnsweredRows'
import { answered } from './runtimeLogin'
import { RuntimeLoginStep } from './RuntimeLoginStep'
import { SetupSteps } from './SetupSteps'

import type { SignInMethod } from './ApiKeyEntry'
import type { Answered } from './runtimeLogin'
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
  const account = agentProvider(instance.provider).account
  const code = login.userCode ?? ''

  return (
    <>
      <p className="text-[13px] leading-5 text-secondary">
        {t('Enter this one-time code on the {account} sign-in page.', { account })}
      </p>
      <div className="flex items-center justify-between gap-4">
        <code className="flex gap-1.5 font-mono text-lg font-semibold text-main" aria-label={code}>
          {Array.from(code, (char) => char).map((char, index) => (
            <span
              key={index}
              aria-hidden
              className={
                char === '-'
                  ? 'flex w-3 items-center justify-center text-tertiary'
                  : 'flex h-10 w-8 items-center justify-center rounded-md border border-line-control bg-state-selected'
              }
            >
              {char === '-' ? '–' : char}
            </span>
          ))}
        </code>
        <button
          type="button"
          aria-label={t('Copy sign-in code')}
          onClick={() => {
            void navigator.clipboard.writeText(code).then(
              () => setCopied(true),
              () => toast.error(t('Could not copy code')),
            )
          }}
          className="flex shrink-0 items-center gap-1.5 text-xs text-secondary hover:text-main"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? t('Copied') : t('Copy')}
        </button>
      </div>
      <div className="flex items-center gap-3">
        {verificationUri && (
          <Button
            size="sm"
            nativeButton={false}
            render={<a href={verificationUri} target="_blank" rel="noopener noreferrer" />}
          >
            {t('Open {account}', { account })} <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
        <span className="flex items-center gap-2 text-[13px] text-secondary">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          {t('Waiting for approval…')}
        </span>
      </div>
      <p className="text-xs leading-5 text-tertiary">
        {t('Keep this window open; leaving it cancels sign-in.')}
      </p>
    </>
  )
}

/** What a team agent's sign-in shows right now; the surrounding dialog or panel owns the actions. */
export function RuntimeLoginBody({
  instance,
  state,
  current,
  onSignOut,
}: {
  instance: RuntimeInstance
  state: RuntimeLogin
  /** How it is signed in now, when it is. */
  current?: SignInMethod
  /** Signs out of the API key; `switching` when an account sign-in follows. */
  onSignOut?: (switching: boolean) => Promise<void>
}) {
  const { login, error, awaiting, authorizationUrl, verificationUri, failed } = state
  const [method, setMethod] = useState<SignInMethod>(current ?? 'account')
  // The attempt a key went to; a new attempt starts over.
  const [keyFor, setKeyFor] = useState<string | null>(null)
  const [ignoredFor, setIgnoredFor] = useState<string | null>(null)
  const keySent = login !== null && keyFor === login.attemptId
  const keyIgnored = keySent && ignoredFor === keyFor
  // What this attempt was already asked; a new attempt asks again.
  const [answers, setAnswers] = useState<{ attemptId: string; rows: Answered[] } | null>(null)
  const rows = answers && answers.attemptId === login?.attemptId ? answers.rows : []
  const { account } = agentProvider(instance.provider)
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

  const signIn =
    awaiting && login?.step ? (
      <>
        <AnsweredRows
          rows={rows}
          onChange={() => void state.cancel().then((cancelled) => cancelled && state.restart())}
        />
        <RuntimeLoginStep
          key={JSON.stringify(login.step)}
          step={login.step}
          submitted={login.codeSubmitted === true}
          onSubmit={async (answer) => {
            const step = login.step

            await state.submitCode(answer)
            const row = step && answered(step, answer)

            if (row) setAnswers({ attemptId: login.attemptId, rows: [...rows, row] })
          }}
        />
      </>
    ) : authorizationUrl && login ? (
      <BrowserCodeEntry
        provider={instance.provider}
        url={authorizationUrl}
        submitted={login.codeSubmitted === true}
        onSubmit={state.submitCode}
      />
    ) : awaiting && login ? (
      <DeviceCode instance={instance} login={login} verificationUri={verificationUri} />
    ) : null

  function byKey(provider: NonNullable<typeof keyable>) {
    if (keyIgnored)
      return (
        <p className="text-[13px] leading-5 text-error">
          {t(
            'The runtime did not take the key. Update Nuphos on the computer it runs on, then try again.',
          )}
        </p>
      )
    if (keySent)
      return (
        <div className="flex items-center gap-3 text-[13px] text-secondary">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          {t('Verifying your sign-in…')}
        </div>
      )
    if (current === 'key' && onSignOut)
      return <RemoveKey name={instance.label} onRemove={() => onSignOut(false)} />

    return (
      <ApiKeyEntry
        provider={provider}
        {...(current === 'account'
          ? {
              note: t(
                'Using a key signs {name} out of its {account} account. Bots keep running on the key.',
                { name: instance.label, account },
              ),
            }
          : {})}
        onSubmit={async (key) => {
          await state.submitCode(key)
          setKeyFor(login?.attemptId ?? null)
        }}
      />
    )
  }

  function byAccount() {
    if (current !== 'key' || !onSignOut) return signIn

    return (
      <>
        <Note>
          {t(
            'The key is removed from the runtime first, then you approve on the {account} sign-in page.',
            { account },
          )}
        </Note>
        <Button size="sm" type="button" onClick={() => void onSignOut(true)}>
          {t('Continue with {account}', { account })}
        </Button>
      </>
    )
  }

  function again(next: SignInMethod) {
    setMethod(next)
    state.restart()
  }
  // A key the vendor turned down fails the sign-in; the way back is another key or the account.
  const rejected =
    failed && keySent && login && signsInWithApiKey(instance.provider)
      ? {
          title: t('Sign in with an API key'),
          body: (
            <KeyRejected
              provider={instance.provider}
              account={account}
              error={login.error}
              onRetry={again}
            />
          ),
        }
      : null

  // The API key's way in sits beside an account sign-in the CLI could take a key in place of.
  function withMethods() {
    if (!keyable || (login?.codeSubmitted && !keySent)) return signIn
    if (keySent) return byKey(keyable)

    return (
      <>
        {current && (
          <p className="flex gap-6 rounded-lg bg-state-selected px-3 py-2 text-[13px]">
            <span className="text-tertiary">{t('Signed in')}</span>
            <span className="text-main">
              {current === 'key' ? t('API key') : t('{account} account', { account })}
            </span>
          </p>
        )}
        <MethodSwitch account={account} value={method} onChange={setMethod} />
        {method === 'key' ? byKey(keyable) : byAccount()}
      </>
    )
  }

  return (
    <>
      <SetupSteps key={state.retry} instance={instance} state={state} failure={rejected}>
        {signIn && withMethods()}
      </SetupSteps>
      {error && login && !failed && <p className="text-xs text-error">{error}</p>}
    </>
  )
}
