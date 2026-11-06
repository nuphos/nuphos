import { KeyRound } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { inputClasses } from './styles'

import { API_KEY } from './apiKeyProviders'

import type { ApiKeyProvider } from './apiKeyProviders'

/** The small way in, next to an account sign-in. */
export function ApiKeyLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs text-secondary underline-offset-2 hover:text-main hover:underline"
    >
      <KeyRound className="h-3.5 w-3.5" />
      {t('Use an API key instead')}
    </button>
  )
}

/**
 * Takes an API key and hands it on once. It is never kept here or shown again: the field
 * is cleared as soon as it is sent.
 */
export function ApiKeyEntry({
  provider,
  onSubmit,
  onBack,
}: {
  provider: ApiKeyProvider
  onSubmit: (key: string) => Promise<void>
  onBack: () => void
}) {
  const [key, setKey] = useState('')
  const [sending, setSending] = useState(false)
  const { vendor, pattern, placeholder } = API_KEY[provider]
  const ready = pattern.test(key.trim())

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!ready || sending) return
    const value = key.trim()

    setKey('')
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
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={key}
          placeholder={placeholder}
          onChange={(event) => setKey(event.target.value)}
          className={inputClasses}
        />
      </label>
      <p className="text-xs leading-5 text-tertiary">
        {t(
          'The key is saved only on the runtime, in the CLI’s own settings. Nuphos does not keep a copy, and the key is not shown again.',
        )}
      </p>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={!ready || sending}>
          {t('Use API key')}
        </Button>
        <Button size="sm" variant="ghost" type="button" disabled={sending} onClick={onBack}>
          {t('Back')}
        </Button>
      </div>
    </form>
  )
}
