import { faSpinner } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useId, useState } from 'react'

import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { AGENT_PROVIDER } from '../../types/runtime'

import { MIN_RUNTIME_PASSWORD as MIN_PASSWORD, runtimePasswordProblem } from './runtimePassword'
import { Field } from './shared'
import { StepActions } from './StepActions'
import { inputClasses } from './styles'
import {
  looksLikeAcpUrl,
  useExternalRuntimeProviderDetection,
} from './useExternalRuntimeProviderDetection'

import type { RegisterExternalRuntimeInput, RuntimeInstance } from '../../types/runtime'

const PASSWORD_HINT = t(
  'The OPENAB_ACP_AUTH_KEY you started the container with — at least {min} characters. `openssl rand -hex 32` makes one.',
  { min: MIN_PASSWORD },
)

export function ExternalRuntimePasswordForm({
  onDetectProvider,
  onRegister,
  onCancel,
  onUsePairingCode,
  footer,
}: {
  /** Probes the runtime with the address and password entered so far. Returns
   *  null when the runtime is unreachable or did not identify itself. */
  onDetectProvider: (url: string, password: string) => Promise<RuntimeInstance['provider'] | null>
  onRegister: (input: RegisterExternalRuntimeInput) => Promise<void>
  onCancel: () => void
  onUsePairingCode: () => void
  /** A dialog's pinned footer for the actions; inline below the fields without one. */
  footer?: HTMLElement | null
}) {
  const formId = useId()
  const [url, setUrl] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const { detecting, detectedProvider } = useExternalRuntimeProviderDetection(
    url,
    password,
    onDetectProvider,
  )
  const urlLooksWrong = url.trim().length > 0 && !looksLikeAcpUrl(url)
  const passwordIssue = runtimePasswordProblem(password.trim())
  const cannotSave =
    saving ||
    !looksLikeAcpUrl(url) ||
    password.trim().length < MIN_PASSWORD ||
    passwordIssue !== undefined

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (cannotSave) return
    setSaving(true)
    try {
      await onRegister({
        url: url.trim(),
        password: password.trim(),
        ...(detectedProvider ? { provider: detectedProvider } : {}),
      })
    } catch (error) {
      toast.apiError(t('Could not connect runtime'), error)
    } finally {
      setSaving(false)
    }
  }

  const primary = (
    <Button size="sm" type="submit" form={formId} disabled={cannotSave}>
      {saving ? t('Connecting…') : t('Connect runtime')}
    </Button>
  )
  const cancel = (
    <button
      type="button"
      onClick={onCancel}
      disabled={saving}
      className="rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60"
    >
      {t('Cancel')}
    </button>
  )
  const switchLink = (side: string) => (
    <button
      type="button"
      onClick={onUsePairingCode}
      disabled={saving}
      className={`${side} rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60`}
    >
      {t('Use a pairing code instead')}
    </button>
  )

  return (
    <form id={formId} onSubmit={(event) => void submit(event)} className="space-y-4">
      <p className="rounded-lg bg-zGray-800/40 p-3 text-[13px] leading-5 text-secondary">
        {t(
          'Start the runtime container with one variable, its admin password, and serve it over wss:// — most hosts provide TLS for you. Then paste its address and that same password here. Nuphos detects which runtime it runs on its own.',
        )}
      </p>
      <Field
        label={t('Address')}
        hint={
          urlLooksWrong
            ? t('Enter the runtime’s ACP address, for example wss://runtime.example.com/acp.')
            : t('The ACP endpoint your runtime serves, usually the host plus /acp.')
        }
      >
        <input
          aria-label={t('Address')}
          className={inputClasses}
          value={url}
          maxLength={500}
          required
          spellCheck={false}
          autoComplete="off"
          placeholder="wss://runtime.example.com/acp"
          onChange={(event) => setUrl(event.target.value)}
          disabled={saving}
        />
      </Field>
      <Field label={t('Admin password')} hint={passwordIssue ?? PASSWORD_HINT}>
        <input
          type="password"
          aria-label={t('Admin password')}
          className={inputClasses}
          value={password}
          maxLength={500}
          required
          autoComplete="off"
          minLength={MIN_PASSWORD}
          onChange={(event) => setPassword(event.target.value)}
          disabled={saving}
        />
      </Field>
      {detecting && (
        <p className="flex items-center gap-1.5 text-[12px] text-tertiary">
          <FontAwesomeIcon icon={faSpinner} spin className="h-3 w-3" />
          {t('Detecting the runtime…')}
        </p>
      )}
      {detectedProvider && (
        <p className="rounded-lg bg-zGray-800/40 p-3 text-[13px] leading-5 text-secondary">
          {t(
            '{provider} detected. Once it is connected, sign it in to {account} with Sign in on its card.',
            {
              provider: AGENT_PROVIDER[detectedProvider].label,
              account: AGENT_PROVIDER[detectedProvider].account,
            },
          )}
          {detectedProvider === 'codex' && ` ${t('That needs runtime image 0.0.7 or newer.')}`}
        </p>
      )}
      {/* Inline as it always was; in a dialog's footer the primary action sits on the right. */}
      {footer === undefined ? (
        <div className="flex items-center gap-2">
          {primary}
          {cancel}
          {switchLink('ml-auto')}
        </div>
      ) : (
        <StepActions footer={footer} className="flex items-center justify-end gap-2">
          {switchLink('mr-auto')}
          {cancel}
          {primary}
        </StepActions>
      )}
    </form>
  )
}
