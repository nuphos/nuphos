import clsx from 'clsx'
import { useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { inputClasses } from './styles'

import type { CliLoginProvider, LocalRuntimeState } from '../../api'

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * A model provider of the user's own for one local agent: a base URL, a key and optional
 * model ids, used the way the agent's own CLI supports one. The key goes to the main process
 * once and is never shown again.
 */
export function CustomProviderSettings({
  provider,
  name,
  saved,
  onSaved,
}: {
  provider: CliLoginProvider
  name: string
  saved: { baseUrl: string; models: string[] } | undefined
  onSaved: (state: LocalRuntimeState) => void
}) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState('')

  function edit() {
    setBaseUrl(saved?.baseUrl ?? '')
    setApiKey('')
    setModels(saved?.models.join('\n') ?? '')
    setEditing(true)
  }

  async function apply(value: Parameters<typeof api.localRuntimeSetCustomProvider>[1]) {
    setBusy(true)
    try {
      onSaved(await api.localRuntimeSetCustomProvider(provider, value))
      setApiKey('')
      setEditing(false)
      toast.success(value ? t('Custom provider saved') : t('Custom provider removed'))
    } catch (cause) {
      toast.apiError(
        value ? t('Could not save the custom provider') : t('Could not remove the custom provider'),
        cause,
      )
    } finally {
      setBusy(false)
    }
  }

  if (!editing)
    return (
      <div className="flex items-start justify-between gap-4 border-t border-line-control/60 px-4 py-3">
        <div className="min-w-0 space-y-0.5 text-[12px] text-tertiary">
          <div className="text-[13px] font-medium text-main">{t('Custom provider')}</div>
          {saved ? (
            <div className="truncate" title={saved.baseUrl}>
              {hostOf(saved.baseUrl)}
              {saved.models.length > 0 && <span> · {saved.models.join(', ')}</span>}
            </div>
          ) : (
            <div>
              {t('Use your own gateway or a compatible API instead of signing in to {name}.', {
                name,
              })}
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {saved && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void apply(null)}>
              {t('Remove')}
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={edit}>
            {saved ? t('Edit') : t('Set up')}
          </Button>
        </div>
      </div>
    )

  return (
    <form
      className="space-y-3 border-t border-line-control/60 px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        void apply({
          baseUrl: baseUrl.trim(),
          models: models
            .split('\n')
            .map((id) => id.trim())
            .filter(Boolean),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        })
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
          onChange={(event) => setBaseUrl(event.target.value)}
          className={inputClasses}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-[12px] text-secondary">{t('API key')}</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          required={!saved}
          value={apiKey}
          placeholder={saved ? t('Saved. Leave empty to keep it.') : ''}
          onChange={(event) => setApiKey(event.target.value)}
          className={inputClasses}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-[12px] text-secondary">
          {t('Model IDs (optional, one per line)')}
        </span>
        <textarea
          rows={3}
          spellCheck={false}
          value={models}
          onChange={(event) => setModels(event.target.value)}
          className={clsx(inputClasses, 'h-auto py-2 font-mono')}
        />
      </label>
      <p className="text-xs leading-5 text-tertiary">
        {t(
          'The key is kept in this computer’s secure credential store and never shown again. Usage and quota from a custom provider show as unknown.',
        )}
      </p>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={busy}>
          {t('Save')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={busy}
          onClick={() => setEditing(false)}
        >
          {t('Cancel')}
        </Button>
      </div>
    </form>
  )
}
