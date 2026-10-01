import { useState } from 'react'

import { Modal } from '../../components/Modal'
import { toast } from '../../components/ui/toast'

export function KvValueDialog({
  initialKey,
  initialValue,
  isNew,
  onClose,
  onSave,
}: {
  initialKey: string
  initialValue: string
  isNew: boolean
  onClose: () => void
  onSave: (key: string, value: string) => Promise<void>
}) {
  const [key, setKey] = useState(initialKey)
  const [value, setValue] = useState(initialValue)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!key.trim()) {
      toast.error('Key is required.')

      return
    }
    setSaving(true)
    try {
      await onSave(key, value)
    } catch (e) {
      toast.apiError('Failed to save value', e, {
        fallback: 'Check your connection and try again.',
      })
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Add key' : 'Edit value'}
      description={isNew ? undefined : initialKey}
      width={560}
    >
      <div className="px-5 py-4 space-y-3 text-[13px]">
        <label className="block">
          <div className="text-[12px] text-secondary mb-1">Key</div>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={!isNew}
            className="w-full px-2.5 py-1.5 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px] disabled:opacity-60"
          />
        </label>
        <label className="block">
          <div className="text-[12px] text-secondary mb-1">Value</div>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={8}
            spellCheck={false}
            className="w-full px-2.5 py-2 rounded-md bg-field border border-zGray-800 text-main outline-none focus:border-zViolet-accent font-mono text-[12.5px] resize-y"
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
          onClick={() => void save()}
          disabled={saving}
          className="px-3 py-1.5 rounded-md bg-zViolet-500 hover:bg-zViolet-400 text-white text-[12.5px] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
