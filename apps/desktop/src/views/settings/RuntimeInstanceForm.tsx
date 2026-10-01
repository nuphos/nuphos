import { useState } from 'react'

import { toast } from '../../components/ui/toast'

import { Field } from './shared'
import { inputClasses } from './styles'

import type { CreateRuntimeInput, RuntimeInstance } from '../../types/runtime'

type RuntimeInstanceEdit = Omit<CreateRuntimeInput, 'provider'>

export function RuntimeInstanceForm({
  instance,
  onSave,
  onCancel,
}: {
  instance: RuntimeInstance
  onSave: (input: RuntimeInstanceEdit) => Promise<void>
  onCancel: () => void
}) {
  const [label, setLabel] = useState(instance.label)
  const [saving, setSaving] = useState(false)
  const cannotSave = saving || !label.trim()

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (cannotSave) return
    setSaving(true)
    try {
      await onSave({ label: label.trim() })
    } catch (error) {
      toast.apiError('Could not save agent', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-4">
      <Field
        label="Agent name"
        hint="Use a name that distinguishes this instance from your other agents."
      >
        <input
          aria-label="Agent name"
          className={inputClasses}
          value={label}
          maxLength={120}
          required
          placeholder="e.g. Claude — work"
          onChange={(event) => setLabel(event.target.value)}
          disabled={saving}
        />
      </Field>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={cannotSave}
          className="rounded-md bg-zViolet-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-zViolet-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save agent'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
