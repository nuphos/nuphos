import { faSpinner } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useState } from 'react'

import { toast } from '../../components/ui/toast'

import { MIN_RUNTIME_PASSWORD as MIN_PASSWORD, runtimePasswordProblem } from './runtimePassword'
import { Field } from './shared'
import { inputClasses } from './styles'
import {
  looksLikeAcpUrl,
  useExternalRuntimeProviderDetection,
} from './useExternalRuntimeProviderDetection'

import type { RegisterExternalRuntimeInput, RuntimeInstance } from '../../types/runtime'

const PASSWORD_HINT = `The OPENAB_ACP_AUTH_KEY you started the container with — at least ${String(MIN_PASSWORD)} characters. \`openssl rand -hex 32\` makes one.`

export function ExternalRuntimePasswordForm({
  onDetectProvider,
  onRegister,
  onCancel,
  onUsePairingCode,
}: {
  /** Probes the runtime with the address and password entered so far. Returns
   *  null when the runtime is unreachable or did not identify itself. */
  onDetectProvider: (url: string, password: string) => Promise<RuntimeInstance['provider'] | null>
  onRegister: (input: RegisterExternalRuntimeInput) => Promise<void>
  onCancel: () => void
  onUsePairingCode: () => void
}) {
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
      toast.apiError('Could not connect agent', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <p className="rounded-lg bg-zGray-800/40 p-3 text-[13px] leading-5 text-secondary">
        Start the agent container with one variable, its admin password, and serve it over wss:// —
        most hosts provide TLS for you. Then paste its address and that same password here. Nuphos
        detects whether it is running Claude Code or Codex on its own.
      </p>
      <Field
        label="Address"
        hint={
          urlLooksWrong
            ? 'Enter the agent’s ACP address, for example wss://runtime.example.com/acp.'
            : 'The ACP endpoint your agent serves, usually the host plus /acp.'
        }
      >
        <input
          aria-label="Address"
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
      <Field label="Admin password" hint={passwordIssue ?? PASSWORD_HINT}>
        <input
          type="password"
          aria-label="Admin password"
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
          Detecting the agent…
        </p>
      )}
      {detectedProvider === 'codex' && (
        <p className="rounded-lg bg-zGray-800/40 p-3 text-[13px] leading-5 text-secondary">
          Codex detected. Once it is connected, sign it in to ChatGPT with Sign in on its card. That
          needs agent image 0.0.7 or newer.
        </p>
      )}
      {detectedProvider === 'claude-code' && (
        <p className="rounded-lg bg-zGray-800/40 p-3 text-[13px] leading-5 text-secondary">
          Claude Code detected. Once it is connected, add its Claude Code account from the agent
          card.
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={cannotSave}
          className="rounded-md bg-zViolet-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-zViolet-500 disabled:opacity-50"
        >
          {saving ? 'Connecting…' : 'Connect agent'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onUsePairingCode}
          disabled={saving}
          className="ml-auto rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60"
        >
          Use a pairing code instead
        </button>
      </div>
    </form>
  )
}
