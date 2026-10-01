import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import { DeviceActivityList } from './DeviceActivityList'
import { Field, SectionHeader } from './shared'
import { inputClasses } from './styles'

import type { DeviceIdentity } from '../../api'

export function LocalExecSection({
  currentTeamId,
  onOpenConversation,
}: {
  currentTeamId?: string
  onOpenConversation?: (sessionId: string) => void
}) {
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null)
  const [label, setLabel] = useState('')
  const [savingLabel, setSavingLabel] = useState(false)

  useEffect(() => {
    let cancelled = false

    void api
      .deviceGetIdentity()
      .then((result) => {
        if (cancelled) return
        setIdentity(result)
        setLabel(result.label)
      })
      .catch((err: unknown) => {
        toast.apiError('Could not load this device', err)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const trimmedLabel = label.trim()
  const labelDirty = identity !== null && trimmedLabel !== identity.label
  const canSaveLabel = labelDirty && trimmedLabel.length > 0 && !savingLabel

  async function saveLabel(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSaveLabel) return
    setSavingLabel(true)
    try {
      const next = await api.deviceSetLabel(trimmedLabel)

      setIdentity(next)
      setLabel(next.label)
      toast.success('Device renamed')
    } catch (err) {
      toast.apiError('Could not rename this device', err)
    } finally {
      setSavingLabel(false)
    }
  }

  return (
    <div>
      <SectionHeader
        title="Local exec"
        description="Keep Nuphos open and signed in to use this computer for local exec. It appears in your conversations when its connection is ready. Only your own conversations can use it."
      />

      {identity && (
        <div className="space-y-5">
          <form onSubmit={(e) => void saveLabel(e)}>
            <Field
              label="Device name"
              hint="Shown wherever this device can be picked for local exec."
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={200}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className={inputClasses}
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!canSaveLabel}
                  className="h-10 flex-shrink-0 px-4"
                >
                  {savingLabel ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </Field>
          </form>

          <DeviceActivityList
            currentTeamId={currentTeamId}
            onOpenConversation={onOpenConversation}
          />
        </div>
      )}
    </div>
  )
}
