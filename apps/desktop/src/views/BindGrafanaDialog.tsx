import { useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'

type Props = {
  teamId: string
  onClose: () => void
  onBound: () => void
}

export function BindGrafanaDialog({ teamId, onClose, onBound }: Props) {
  const [name, setName] = useState('')
  const [grafanaUrl, setGrafanaUrl] = useState('')
  const [saToken, setSaToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    if (submitting) return
    onClose()
  }

  async function submit() {
    setError(null)
    const n = name.trim()
    const u = grafanaUrl.trim()
    const t = saToken.trim()

    if (!n) return setError('Name is required.')
    if (!/^https?:\/\//.test(u)) return setError('Grafana URL must start with http(s)://')
    if (!t) return setError('Service account token is required.')
    setSubmitting(true)
    try {
      await api.atlasBindGrafanaInstance(teamId, n, u.replace(/\/$/, ''), t)
      onBound()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={close} title="Bind Grafana instance" width={480}>
      <div className="px-5 py-4 space-y-3 text-[13px]">
        <Field label="Name" hint="A short label, e.g. prod or staging">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="prod"
            autoFocus
            className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent"
          />
        </Field>
        <Field label="Grafana URL" hint="Base URL of your Grafana instance (no trailing path)">
          <input
            value={grafanaUrl}
            onChange={(e) => setGrafanaUrl(e.target.value)}
            placeholder="https://grafana.example.com"
            className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
          />
        </Field>
        <Field
          label="Service account token"
          hint="Create one at Administration → Service accounts → Add token. Stored encrypted by Nuphos backend."
        >
          <input
            value={saToken}
            onChange={(e) => setSaToken(e.target.value)}
            placeholder="glsa_..."
            type="password"
            className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
          />
        </Field>
        {error && <div className="text-error text-[12px] whitespace-pre-wrap">{error}</div>}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800">
        <button
          onClick={close}
          disabled={submitting}
          className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={() => void submit()}
          disabled={submitting}
          className="px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] disabled:opacity-50"
        >
          {submitting ? 'Binding…' : 'Bind'}
        </button>
      </div>
    </Modal>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <div className="text-[12px] text-secondary mb-1">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-tertiary mt-1">{hint}</div>}
    </label>
  )
}
