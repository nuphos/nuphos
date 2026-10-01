import { useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'

import { normalizeRuntimeDefaults, runtimeDefaultsError } from './runtimeDefaults'
import { RuntimeDefaultsFields } from './RuntimeDefaultsFields'
import { PanelHeading } from './RuntimePanel'
import { useRuntimeModelCatalog } from './useRuntimeModelCatalog'

import type { RuntimeDefaults, RuntimeInstance } from '../../types/runtime'

export function RuntimeDefaultsSection({
  teamId,
  instance,
  isAdmin,
}: {
  teamId: string
  instance: RuntimeInstance
  isAdmin: boolean
}) {
  // Keep a draft only while editing; catalog refreshes must not overwrite unsaved changes.
  const [draft, setDraft] = useState<RuntimeDefaults | null>(null)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState<RuntimeDefaults | null>(null)
  const value = draft ?? instance.defaults ?? {}
  const discovery = useRuntimeModelCatalog(
    teamId,
    instance.id,
    isAdmin && instance.status === 'active',
    value.model,
  )
  const validationError = runtimeDefaultsError(value, discovery.catalog?.controls)
  const validating = discovery.loading && Boolean(value.effort || value.fast)
  const savedKey = JSON.stringify(normalizeRuntimeDefaults(instance.defaults ?? {}))
  const valueKey = JSON.stringify(normalizeRuntimeDefaults(value))
  const submittedKey = submitted ? JSON.stringify(submitted) : null
  const dirty = valueKey !== (submittedKey ?? savedKey)

  // Release the local saved value once the catalog acknowledges it, so later remote edits show up.
  if (submittedKey !== null && submittedKey === savedKey) {
    setSubmitted(null)
    if (valueKey === submittedKey) setDraft(null)
  }

  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !dirty || validating || validationError) return
    setSaving(true)
    try {
      await api.atlasUpdateRuntimeInstance(teamId, instance.id, {
        defaults: normalizeRuntimeDefaults(value),
      })
      toast.success('Defaults saved', 'New conversations will use these settings.')
      setSubmitted(normalizeRuntimeDefaults(value))
      window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    } catch (error) {
      toast.apiError('Could not save agent defaults', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void save(event)}>
      <PanelHeading
        title="Conversation defaults"
        hint="New conversations on this agent start with these settings."
      />
      <RuntimeDefaultsFields
        discovery={discovery}
        value={value}
        onChange={setDraft}
        disabled={!isAdmin || saving}
      />
      {dirty && (
        <div className="mt-4 space-y-3">
          {validationError && (
            <p role="alert" className="text-xs text-red-400">
              {validationError}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => setDraft(submitted)}
              className="rounded-md px-3 py-1.5 text-xs text-secondary hover:bg-zGray-800/60 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !isAdmin || validating || Boolean(validationError)}
              className="rounded-md bg-zViolet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-zViolet-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save defaults'}
            </button>
          </div>
        </div>
      )}
    </form>
  )
}
