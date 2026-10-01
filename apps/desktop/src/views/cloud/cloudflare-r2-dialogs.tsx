import { faDatabase } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { useState } from 'react'

import { Modal } from '../../components/Modal'
import { toast } from '../../components/ui/toast'

export function R2CredentialsGate({
  onBind,
}: {
  onBind: (input: { accessKeyId: string; secretAccessKey: string }) => Promise<void>
}) {
  const [bindingCreds, setBindingCreds] = useState(false)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-3">
          <FontAwesomeIcon icon={faDatabase} className="w-8 h-8 mx-auto text-tertiary" />
          <div className="text-[13px] text-main font-medium">
            Bind R2 S3 credentials to browse objects
          </div>
          <div className="text-[12.5px] text-secondary leading-relaxed">
            Browsing, uploading and downloading objects uses R2's S3-compatible API, which needs a
            separate Access Key ID and Secret. Create one in the Cloudflare dashboard under R2 →
            Manage API tokens.
          </div>
          <button
            onClick={() => setBindingCreds(true)}
            className="px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px]"
          >
            Bind R2 credentials
          </button>
        </div>
      </div>
      {bindingCreds && (
        <BindR2CredentialsDialog
          onClose={() => setBindingCreds(false)}
          onBind={async (input) => {
            await onBind(input)
            setBindingCreds(false)
          }}
        />
      )}
    </div>
  )
}

function BindR2CredentialsDialog({
  onClose,
  onBind,
}: {
  onClose: () => void
  onBind: (input: { accessKeyId: string; secretAccessKey: string }) => Promise<void>
}) {
  const [accessKeyId, setAccessKeyId] = useState('')
  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [saving, setSaving] = useState(false)

  async function bind() {
    if (!accessKeyId.trim() || !secretAccessKey.trim()) {
      toast.error('Both fields are required.')

      return
    }
    setSaving(true)
    try {
      await onBind({
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
      })
    } catch (e) {
      toast.apiError('Failed to bind R2 credentials', e, {
        fallback: 'Check your connection and try again.',
      })
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Bind R2 S3 credentials"
      description="R2 → Manage API tokens → Create API token"
      width={480}
    >
      <div className="px-5 py-4 space-y-3 text-[13px]">
        <label className="block">
          <div className="text-[12px] text-secondary mb-1">Access Key ID</div>
          <input
            value={accessKeyId}
            onChange={(e) => setAccessKeyId(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
          />
        </label>
        <label className="block">
          <div className="text-[12px] text-secondary mb-1">Secret Access Key</div>
          <input
            type="password"
            value={secretAccessKey}
            onChange={(e) => setSecretAccessKey(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px]"
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-zGray-800">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-3 py-1.5 rounded-md text-secondary hover:text-main text-[12.5px] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={() => void bind()}
          disabled={saving}
          className="px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] disabled:opacity-50"
        >
          {saving ? 'Verifying…' : 'Bind'}
        </button>
      </div>
    </Modal>
  )
}
