import clsx from 'clsx'
import { Check, ExternalLink, Eye, EyeOff, Info } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { API_KEY } from './apiKeyProviders'
import { inputClasses } from './styles'

import type { ApiKeyProvider } from './apiKeyProviders'

export type SignInMethod = 'account' | 'key'

/** Picks between the provider's account sign-in and an API key. */
export function MethodSwitch({
  account,
  value,
  onChange,
}: {
  account: string
  value: SignInMethod
  onChange: (value: SignInMethod) => void
}) {
  const options: { value: SignInMethod; label: string }[] = [
    { value: 'account', label: t('{account} account', { account }) },
    { value: 'key', label: t('API key') },
  ]

  return (
    <div
      role="radiogroup"
      aria-label={t('Sign-in method')}
      className="grid grid-cols-2 gap-1 rounded-lg bg-state-selected p-1"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'h-8 rounded-md text-[13px]',
            value === option.value
              ? 'bg-surface font-medium text-main shadow-sm'
              : 'text-secondary hover:text-main',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** A short explanation in a tinted box, for what a choice is about to change. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-lg bg-state-selected px-3 py-2.5 text-xs leading-5 text-secondary">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/**
 * Takes an API key and hands it on once. It is never kept here or shown again: the field
 * is cleared as soon as it is sent. The vendor's prefix is a hint, not a gate.
 */
export function ApiKeyEntry({
  provider,
  note,
  onSubmit,
}: {
  provider: ApiKeyProvider
  /** What using a key replaces, when something does. */
  note?: string
  onSubmit: (key: string) => Promise<void>
}) {
  const [key, setKey] = useState('')
  const [shown, setShown] = useState(false)
  const [sending, setSending] = useState(false)
  const { vendor, pattern, prefix, keys } = API_KEY[provider]
  const value = key.trim()

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!value || sending) return
    setKey('')
    setShown(false)
    setSending(true)
    try {
      await onSubmit(value)
    } catch (cause) {
      toast.apiError(t('Could not use the API key'), cause)
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium text-main">
          {t('{vendor} API key', { vendor })}
        </span>
        <span className="relative block">
          <input
            type={shown ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={key}
            placeholder={`${prefix}…`}
            onChange={(event) => setKey(event.target.value)}
            className={clsx(inputClasses, 'pr-10 font-mono')}
          />
          <button
            type="button"
            aria-label={shown ? t('Hide key') : t('Show key')}
            onClick={() => setShown((current) => !current)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-tertiary hover:text-main"
          >
            {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </span>
      </label>
      {value &&
        (pattern.test(value) ? (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <Check className="h-3.5 w-3.5" />
            {t('Looks like an {vendor} key', { vendor })}
          </p>
        ) : (
          <p className="text-xs text-tertiary">
            {t('{vendor} keys usually start with {prefix}', { vendor, prefix })}
          </p>
        ))}
      <a
        href={keys.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-fit items-center gap-1.5 text-xs text-secondary hover:text-main hover:underline"
      >
        <ExternalLink className="h-3.5 w-3.5" />
        {t('Get a key in the {place}', { place: keys.place })}
      </a>
      {note && <Note>{note}</Note>}
      <p className="text-xs leading-5 text-tertiary">
        {t(
          'The key is saved only on the runtime, in the CLI’s own settings. Nuphos only relays it, encrypted, and never shows it again.',
        )}
      </p>
      <Button size="sm" type="submit" disabled={!value || sending}>
        {note ? t('Use this key') : t('Sign in')}
      </Button>
    </form>
  )
}

/** Removing a key signs the agent out; the confirmation says what stops. */
export function RemoveKey({ name, onRemove }: { name: string; onRemove: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)

  if (!confirming)
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-secondary">{t('Signed in with an API key.')}</p>
        <Button size="sm" variant="secondary" type="button" onClick={() => setConfirming(true)}>
          {t('Remove key')}
        </Button>
      </div>
    )

  return (
    <div className="space-y-3 rounded-lg border border-line-control px-4 py-3">
      <p className="text-[13px] font-medium text-main">{t('Remove the API key?')}</p>
      <p className="text-xs leading-5 text-secondary">
        {t(
          '{name} signs out. Bots and tasks that use it stop until you sign in again, with an account or a new key.',
          { name },
        )}
      </p>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={removing}
          onClick={() => setConfirming(false)}
        >
          {t('Cancel')}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          type="button"
          disabled={removing}
          onClick={() => {
            setRemoving(true)
            void onRemove().finally(() => setRemoving(false))
          }}
        >
          {t('Remove key')}
        </Button>
      </div>
    </div>
  )
}

/** A key its vendor turned down: the runtime's words, then another key or the account. */
export function KeyRejected({
  provider,
  account,
  error,
  onRetry,
}: {
  provider: ApiKeyProvider
  account: string
  error: string | undefined
  onRetry: (method: SignInMethod) => void
}) {
  return (
    <div className="mt-1 space-y-3">
      <p className="text-[13px] leading-5 text-error">
        {t('{vendor} didn’t accept this key. It may be revoked, or belong to another workspace.', {
          vendor: API_KEY[provider].vendor,
        })}
      </p>
      {error && (
        <pre className="whitespace-pre-wrap rounded-md border border-line-control px-3 py-2 font-mono text-xs text-secondary select-text">
          {error}
        </pre>
      )}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="secondary" type="button" onClick={() => onRetry('key')}>
          {t('Enter another key')}
        </Button>
        <button
          type="button"
          onClick={() => onRetry('account')}
          className="text-[13px] text-secondary hover:text-main hover:underline"
        >
          {t('Use a {account} account', { account })}
        </button>
      </div>
    </div>
  )
}
