import { useState } from 'react'

import { toast } from '../../components/ui/toast'
import { normalizeAgentUrl, normalizePairingCode } from '../../lib/connectAgentLink'

import { submitPairing } from './connectAgent'
import { Field } from './shared'
import { inputClasses } from './styles'

import type { PairExternalRuntimeInput, PairedExternalRuntime } from '../../types/runtime'

/** Fallback for when the console's Connect link does not reach Desktop: the same pairing, typed in. */
export function ExternalRuntimeForm({
  onPair,
  onConnected,
  onCancel,
  onUsePassword,
}: {
  onPair: (input: PairExternalRuntimeInput) => Promise<PairedExternalRuntime>
  onConnected: (runtime: PairedExternalRuntime) => void
  onCancel: () => void
  onUsePassword?: () => void
}) {
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
      toast.apiError('Could not connect agent', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      className="space-y-4"
    >
      <p className="rounded-lg bg-zGray-800/40 p-3 text-[13px] leading-5 text-secondary">
        Open your agent’s address in a browser, sign in to its console and choose Connect to Nuphos.
        If Nuphos does not open by itself, copy the address and pairing code the console shows into
        this form. Agents without a console connect with their password instead.
      </p>
      <Field
        label="Address"
        hint={
          url.trim() && !agentUrl
            ? 'Enter the agent’s address, for example https://agent.example.com.'
            : 'The address the agent console shows.'
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
          placeholder="https://agent.example.com"
          onChange={(event) => {
            setUrl(event.target.value)
            setDuplicateId(null)
          }}
          disabled={saving}
        />
      </Field>
      <Field
        label="Pairing code"
        hint="Works once and expires after a few minutes. Generate a new one in the console if it has."
      >
        <input
          aria-label="Pairing code"
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
          This agent is already connected to this team. Updating the existing connection gives it a
          new key and keeps its conversations.
        </p>
      )}
      <div className="flex items-center gap-2">
        {duplicateId ? (
          <button
            type="button"
            disabled={cannotSave}
            onClick={() => void submit(duplicateId)}
            className="rounded-md bg-zViolet-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-zViolet-500 disabled:opacity-50"
          >
            {saving ? 'Updating…' : 'Update existing connection'}
          </button>
        ) : (
          <button
            type="submit"
            disabled={cannotSave}
            className="rounded-md bg-zViolet-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-zViolet-500 disabled:opacity-50"
          >
            {saving ? 'Connecting…' : 'Connect agent'}
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60"
        >
          Cancel
        </button>
        {onUsePassword && (
          <button
            type="button"
            onClick={onUsePassword}
            disabled={saving}
            className="ml-auto rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60"
          >
            Use a password instead
          </button>
        )}
      </div>
    </form>
  )
}
