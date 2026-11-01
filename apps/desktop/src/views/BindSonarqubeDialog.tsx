import { useState } from 'react'

import { api } from '../api'
import { Modal } from '../components/Modal'
import { Button } from '../components/ui/button'
import { toast } from '../components/ui/toast'
import { t } from '../i18n'

type Props = {
  teamId: string
  onClose: () => void
  onBound: () => void
}

export function BindSonarqubeDialog({ teamId, onClose, onBound }: Props) {
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function close() {
    if (!submitting) onClose()
  }

  async function submit() {
    const nextLabel = label.trim()
    const nextBaseUrl = baseUrl.trim().replace(/\/$/, '')
    const nextToken = token.trim()

    if (!nextLabel) return toast.error(t('Label is required.'))
    if (!/^https?:\/\//i.test(nextBaseUrl)) {
      return toast.error(t('SonarQube URL must start with http:// or https://.'))
    }
    if (!nextToken) return toast.error(t('A SonarQube user token is required.'))

    setSubmitting(true)
    try {
      await api.atlasBindSonarqubeIntegration(teamId, nextLabel, nextBaseUrl, nextToken)
      onBound()
    } catch (cause) {
      toast.apiError(t('Could not connect {name}', { name: 'SonarQube' }), cause, {
        fallback: t('Check the details and your connection, then try again.'),
      })
      setSubmitting(false)
    }
  }

  return (
    <Modal open onClose={close} title={t('Connect {name}', { name: 'SonarQube' })} width={500}>
      <div className="px-5 py-4 space-y-3 text-[13px]">
        <p className="text-secondary text-[12.5px] leading-relaxed">
          {t(
            'Nuphos validates the token against this instance and stores it encrypted on the server. Source code is not uploaded by this connector.',
          )}
        </p>
        <Field label={t('Label')} hint={t('A short name such as security or staging')}>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="security"
            autoFocus
            className="w-full px-2.5 py-1.5 rounded-md bg-surface border border-zGray-800 text-main outline-none focus:border-zViolet-accent"
          />
        </Field>
        <Field
          label={t('SonarQube URL')}
          hint={t('The public base URL of your SonarQube instance')}
        >
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://sonarqube.example.com"
            className="w-full px-2.5 py-1.5 rounded-md bg-surface border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
          />
        </Field>
        <Field
          label={t('User token')}
          hint={t(
            'Create a token under My Account → Security. Use a dedicated read-only service user when possible.',
          )}
        >
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="squ_..."
            type="password"
            autoComplete="off"
            className="w-full px-2.5 py-1.5 rounded-md bg-surface border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
          />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800">
        <button
          type="button"
          onClick={close}
          disabled={submitting}
          className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px] disabled:opacity-50"
        >
          {t('Cancel')}
        </button>
        <Button size="sm" type="button" onClick={() => void submit()} disabled={submitting}>
          {submitting ? t('Connecting…') : t('Connect')}
        </Button>
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
