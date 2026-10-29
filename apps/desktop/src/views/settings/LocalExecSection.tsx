import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { DeviceActivityList } from './DeviceActivityList'
import { Field, LoadFailed, SectionHeader } from './shared'
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
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    void api
      .deviceGetIdentity()
      .then((result) => {
        if (cancelled) return
        setIdentity(result)
        setLabel(result.label)
        setFailed(false)
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailed(true)
        toast.apiError(t('Could not load this computer'), err)
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

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
      toast.success(t('Computer renamed'))
    } catch (err) {
      toast.apiError(t('Could not rename this computer'), err)
    } finally {
      setSavingLabel(false)
    }
  }

  return (
    <div>
      <SectionHeader
        title={t('Local exec')}
        description={t(
          'Keep Nuphos open and signed in to use this computer for local exec. Your agents can use it once its connection is ready. Only your own agents can use it.',
        )}
      />

      {!identity &&
        (failed ? (
          <LoadFailed
            message={t('Couldn’t load this computer.')}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        ) : (
          <div aria-busy="true" className="h-16 animate-pulse rounded-lg bg-zGray-800/40" />
        ))}
      {identity && (
        <div className="space-y-5">
          <form onSubmit={(e) => void saveLabel(e)}>
            <Field
              label={t('Computer name')}
              hint={t('Shown wherever this computer can be picked for local exec.')}
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
                  {savingLabel ? t('Saving…') : t('Save')}
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
