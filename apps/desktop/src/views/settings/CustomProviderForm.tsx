import clsx from 'clsx'
import { Check, CircleAlert, Loader2, Plug, WifiOff, X } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { Button } from '../../components/ui/button'
import { t } from '../../i18n'

import { inputClasses } from './styles'

import type { CliLoginProvider, CustomProviderCheck } from '../../api'

type Value = { baseUrl: string; apiKey?: string; models: string[] }

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The main process's rule (parseCustomProvider), checked as it is typed. */
function urlProblem(value: string): string | undefined {
  const typed = value.trim()

  // Still typing the scheme.
  if (!typed || 'https://'.startsWith(typed) || 'http://'.startsWith(typed)) return
  try {
    const url = new URL(typed)

    if (
      (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))) &&
      !url.username &&
      !url.password
    )
      return
  } catch {
    // Not a URL yet: the same answer as the wrong scheme.
  }

  return t('The base URL must use https://, or http:// to this computer.')
}

const Line = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
  <li className="flex gap-2">
    {ok ? (
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
    ) : (
      <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-error" />
    )}
    <span>{children}</span>
  </li>
)

/** What the one test request found, line by line, with the request that failed. */
function CheckResult({
  check,
  provider,
}: {
  check: CustomProviderCheck
  provider: CliLoginProvider
}) {
  if (!check.reached)
    return (
      <p className="flex gap-2 rounded-lg bg-warning/10 px-3 py-2.5 text-xs leading-5 text-warning">
        <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t(
          'Couldn’t reach {host} within 10 s. You can still save; {name} will fail to start until it answers.',
          { host: check.host, name: provider === 'codex' ? 'Codex' : 'Claude Code' },
        )}
      </p>
    )
  const { failure, models } = check
  const wrongApi =
    provider === 'codex'
      ? t(
          'Codex needs the OpenAI Responses API, which this URL doesn’t serve. Use the provider’s base URL, such as https://api.example.com/v1.',
        )
      : t('This URL doesn’t answer as the Anthropic API does. Check the base URL.')

  return (
    <div
      className={clsx(
        'space-y-2 rounded-lg px-3 py-2.5 text-xs leading-5 text-main',
        failure ? 'bg-error/5' : 'bg-success/10',
      )}
    >
      <ul className="space-y-1">
        <Line ok>{t('Reached {host} in {ms} ms', { host: check.host, ms: String(check.ms) })}</Line>
        {failure?.reason === 'key' && (
          <Line ok={false}>{t('The provider turned down this key.')}</Line>
        )}
        {failure?.reason === 'api' && <Line ok={false}>{wrongApi}</Line>}
        {!failure && <Line ok>{t('Key accepted')}</Line>}
        {models && (
          <Line ok={models.answered === models.total}>
            {t('{answered} of {total} model IDs answered', {
              answered: String(models.answered),
              total: String(models.total),
            })}
          </Line>
        )}
      </ul>
      {failure && (
        <pre className="rounded-md border border-line-control bg-surface px-3 py-1.5 font-mono text-xs text-secondary select-text">
          {failure.request}
        </pre>
      )}
    </div>
  )
}

/**
 * Edits a custom provider: the URL rule shows under the field, Test connection sends the one
 * request Save would, and a refusal stays in place rather than in a toast.
 */
export function CustomProviderForm({
  provider,
  saved,
  onSave,
  onCancel,
}: {
  provider: CliLoginProvider
  saved: { baseUrl: string; models: string[] } | undefined
  onSave: (value: Value) => Promise<void>
  onCancel: () => void
}) {
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? '')
  // A saved key is never shown; Replace opens an empty field for a new one.
  const [apiKey, setApiKey] = useState<string | null>(saved ? null : '')
  const [models, setModels] = useState(saved?.models.join('\n') ?? '')
  const [busy, setBusy] = useState<'save' | 'check' | null>(null)
  const [check, setCheck] = useState<CustomProviderCheck | null>(null)
  const [error, setError] = useState<string | null>(null)
  const problem = urlProblem(baseUrl)
  const value = (): Value => ({
    baseUrl: baseUrl.trim(),
    models: models
      .split('\n')
      .map((id) => id.trim())
      .filter(Boolean),
    ...(apiKey?.trim() ? { apiKey: apiKey.trim() } : {}),
  })

  async function run(kind: 'save' | 'check') {
    setBusy(kind)
    setError(null)
    if (kind === 'check') setCheck(null)
    try {
      if (kind === 'check') setCheck(await api.localRuntimeCheckCustomProvider(provider, value()))
      else await onSave(value())
    } catch (cause) {
      setError(parseAtlasError(cause).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <form
      className="space-y-3 px-5 py-4"
      onSubmit={(event) => {
        event.preventDefault()
        void run('save')
      }}
    >
      <div className="text-[13px] font-medium text-main">{t('Custom provider')}</div>
      <label className="block space-y-1.5">
        <span className="text-[12px] text-secondary">{t('Base URL')}</span>
        <input
          type="url"
          required
          spellCheck={false}
          autoFocus
          value={baseUrl}
          placeholder="https://"
          aria-invalid={problem ? true : undefined}
          onChange={(event) => {
            setBaseUrl(event.target.value)
            setCheck(null)
          }}
          className={clsx(inputClasses, 'font-mono', problem && 'border-error')}
        />
        {problem ? (
          <span className="flex items-center gap-1.5 text-xs text-error">
            <CircleAlert className="h-3.5 w-3.5 shrink-0" />
            {problem}
          </span>
        ) : (
          <span className="block text-xs text-tertiary">
            {t('Your gateway or a compatible API. https://, or http:// to this computer.')}
          </span>
        )}
      </label>
      <div className="space-y-1.5">
        <span className="block text-[12px] text-secondary">{t('API key')}</span>
        {apiKey === null ? (
          <div className="flex h-9 items-center justify-between rounded-lg border border-line-control px-3 text-[13px] text-secondary">
            <span className="font-mono">{t('•••• saved')}</span>
            <button
              type="button"
              className="text-xs text-main hover:underline"
              onClick={() => setApiKey('')}
            >
              {t('Replace')}
            </button>
          </div>
        ) : (
          <input
            type="password"
            aria-label={t('API key')}
            autoComplete="off"
            spellCheck={false}
            required={!saved}
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value)
              setCheck(null)
            }}
            className={clsx(inputClasses, 'font-mono')}
          />
        )}
      </div>
      {/* Codex's adapter refuses any model outside Codex's catalog but the configured one (#5214). */}
      {provider === 'codex' ? (
        <label className="block space-y-1.5">
          <span className="text-[12px] text-secondary">{t('Model ID')}</span>
          <input
            spellCheck={false}
            value={models}
            onChange={(event) => setModels(event.target.value)}
            className={clsx(inputClasses, 'font-mono')}
          />
          <span className="block text-xs text-tertiary">
            {t('Optional. Codex runs this model.')}
          </span>
        </label>
      ) : (
        <label className="block space-y-1.5">
          <span className="text-[12px] text-secondary">{t('Model IDs')}</span>
          <textarea
            rows={2}
            spellCheck={false}
            value={models}
            onChange={(event) => setModels(event.target.value)}
            className={clsx(inputClasses, 'h-auto py-2 font-mono')}
          />
          <span className="block text-xs text-tertiary">
            {t('Optional. The first one is the default in Model settings.')}
          </span>
        </label>
      )}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={busy !== null || !baseUrl.trim() || problem !== undefined}
          onClick={() => void run('check')}
        >
          {busy === 'check' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plug className="h-3.5 w-3.5" />
          )}
          {t('Test connection')}
        </Button>
        <span className="text-xs text-tertiary">{t('Sends one request with this key')}</span>
      </div>
      {check && <CheckResult check={check} provider={provider} />}
      {error && (
        <p
          role="alert"
          className="flex gap-2 whitespace-pre-line rounded-lg bg-error/5 px-3 py-2.5 text-xs leading-5 text-error"
        >
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      <p className="text-xs leading-5 text-tertiary">
        {t(
          'The key is kept in this computer’s secure credential store and never shown again. Usage and quota from a custom provider show as unknown.',
        )}
      </p>
      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={busy !== null}
          onClick={onCancel}
        >
          {t('Cancel')}
        </Button>
        <Button size="sm" type="submit" disabled={busy !== null}>
          {check?.reached === false ? t('Save anyway') : t('Save')}
        </Button>
      </div>
    </form>
  )
}
