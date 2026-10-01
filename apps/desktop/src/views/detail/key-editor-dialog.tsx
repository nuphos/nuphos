import { useState } from 'react'

import { Modal } from '../../components/Modal'
import { useReportVisibleError } from '../../components/VisibleErrorReporter'
import { useResetOnKey } from '../useResetOnKey'

import type { KeyDraft } from './config-secret-model'

export function KeyEditorDialog({
  draft,
  valueLabel,
  onClose,
  onSubmit,
  onError,
}: {
  draft: KeyDraft | null
  valueLabel: string
  onClose: () => void
  onSubmit: (key: string, value: string) => Promise<void>
  onError: (message: string) => void
}) {
  const [key, setKey] = useState(draft?.key ?? '')
  const [value, setValue] = useState(draft?.value ?? '')
  const [pending, setPending] = useState(false)

  // The dialog stays mounted across opens, so seed the fields whenever the
  // caller swaps in a different draft. Callers always clear the draft to null
  // on close, so reopening the same key still flips this key.
  useResetOnKey(draft ? `${draft.title}\0${draft.key}\0${draft.value}` : '', () => {
    setKey(draft?.key ?? '')
    setValue(draft?.value ?? '')
    setPending(false)
  })

  async function submit() {
    const cleanKey = key.trim()

    if (!cleanKey) {
      onError('Key is required.')

      return
    }
    setPending(true)
    try {
      await onSubmit(cleanKey, value)
    } catch (e) {
      onError(String(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      open={Boolean(draft)}
      onClose={pending ? () => {} : onClose}
      title={draft?.title ?? ''}
      width={560}
    >
      <div className="space-y-4 px-5 py-4">
        <label className="block">
          <div className="mb-1.5 text-[11.5px] uppercase tracking-wider text-tertiary">Key</div>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={pending}
            className="h-9 w-full rounded border border-zGray-800 bg-field px-3 font-mono text-[12.5px] text-main outline-none focus:border-zViolet-accent disabled:opacity-60"
          />
        </label>
        <label className="block">
          <div className="mb-1.5 text-[11.5px] uppercase tracking-wider text-tertiary">
            {valueLabel}
          </div>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            rows={10}
            className="min-h-48 w-full resize-y rounded border border-zGray-800 bg-field px-3 py-2 font-mono text-[12.5px] leading-relaxed text-main outline-none focus:border-zViolet-accent disabled:opacity-60"
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-zGray-800 bg-zGray-900/60 px-5 py-3">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="h-8 rounded-md px-3 text-[12.5px] text-secondary hover:bg-zGray-800 hover:text-main disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending}
          className="h-8 rounded-md bg-zViolet-500 px-3 text-[12.5px] font-medium text-white hover:bg-zViolet-400 disabled:opacity-60"
        >
          {pending ? 'Saving...' : (draft?.submitLabel ?? 'Save')}
        </button>
      </div>
    </Modal>
  )
}

export function ActionError({ message }: { message: string }) {
  useReportVisibleError(message, 'resource_action_error')

  return (
    <div className="border border-error/30 bg-error/10 px-4 py-3 text-[12.5px] text-error">
      {message}
    </div>
  )
}
