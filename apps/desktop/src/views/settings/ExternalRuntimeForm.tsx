import { useId, useState } from 'react'

import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { normalizeAgentUrl, normalizePairingCode } from '../../lib/connectAgentLink'

import { submitPairing } from './connectAgent'
import { Field } from './shared'
import { StepActions } from './StepActions'
import { inputClasses } from './styles'

import type { PairExternalRuntimeInput, PairedExternalRuntime } from '../../types/runtime'

/** Fallback for when the console's Connect link does not reach Desktop: the same pairing, typed in. */
export function ExternalRuntimeForm({
  onPair,
  onConnected,
  onCancel,
  onUsePassword,
  footer,
}: {
  onPair: (input: PairExternalRuntimeInput) => Promise<PairedExternalRuntime>
  onConnected: (runtime: PairedExternalRuntime) => void
  onCancel: () => void
  onUsePassword?: () => void
  /** A dialog's pinned footer for the actions; inline below the fields without one. */
  footer?: HTMLElement | null
}) {
  const formId = useId()
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [duplicateId, setDuplicateId] = useState<string | null>(null)
  const agentUrl = normalizeAgentUrl(url)
  const pairingCode = normalizePairingCode(code)
  const cannotSave = saving || !agentUrl || !pairingCode

  async function submit(replaceRuntimeId?: string) {
    if (saving || !agentUrl || !pairingCode) return
    setSaving(true)
    try {
      const outcome = await submitPairing(() =>
        onPair({
          url: agentUrl,
          code: pairingCode,
          ...(replaceRuntimeId ? { replaceRuntimeId } : {}),
        }),
      )

      if (outcome.kind === 'duplicate') setDuplicateId(outcome.runtimeId)
      else onConnected(outcome.runtime)
    } catch (error) {
      toast.apiError(t('Could not connect runtime'), error)
    } finally {
      setSaving(false)
    }
  }

  const primary = duplicateId ? (
    <Button size="sm" type="button" disabled={cannotSave} onClick={() => void submit(duplicateId)}>
      {saving ? t('Updating…') : t('Update existing connection')}
    </Button>
  ) : (
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
  const switchLink = (side: string) =>
    onUsePassword && (
      <button
        type="button"
        onClick={onUsePassword}
        disabled={saving}
        className={`${side} rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60`}
      >
        {t('Use a password instead')}
      </button>
    )

  return (
    <form
      id={formId}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="space-y-4"
    >
      <p className="rounded-lg bg-zGray-800/40 p-3 text-[13px] leading-5 text-secondary">
        {t(
          'Open your runtime’s address in a browser, sign in to its console and choose Connect to Nuphos. If Nuphos does not open by itself, copy the address and pairing code the console shows into this form. Runtimes without a console connect with their password instead.',
        )}
      </p>
      <Field
        label={t('Address')}
        hint={
          url.trim() && !agentUrl
            ? t('Enter the runtime’s address, for example https://agent.example.com.')
            : t('The address the runtime console shows.')
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
          placeholder="https://agent.example.com"
          onChange={(event) => {
            setUrl(event.target.value)
            setDuplicateId(null)
          }}
          disabled={saving}
        />
      </Field>
      <Field
        label={t('Pairing code')}
        hint={t(
          'Works once and expires after a few minutes. Generate a new one in the console if it has.',
        )}
      >
        <input
          aria-label={t('Pairing code')}
          className={`${inputClasses} font-mono uppercase tracking-wider`}
          value={code}
          maxLength={40}
          required
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setCode(event.target.value)
            setDuplicateId(null)
          }}
          disabled={saving}
        />
      </Field>
      {duplicateId && (
        <p className="rounded-lg bg-zGray-800/40 p-3 text-[13px] leading-5 text-secondary">
          {t(
            'This runtime is already connected to this team. Updating the existing connection gives it a new key and keeps its agents.',
          )}
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
