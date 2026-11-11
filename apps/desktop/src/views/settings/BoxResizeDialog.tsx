import { NumberField } from '@base-ui/react/number-field'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { fieldClass } from '../../components/ui/input-group'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { openBoxPaywall } from './boxPaywallStore'
import { boxSizeChoices } from './boxPresentation'
import {
  BOX_RESIZE_EFFECT,
  boxCurrentSize,
  boxDiskHint,
  boxResizeRequest,
} from './boxResizePresentation'
import { boxRestarts } from './boxRestartStore'
import { BoxSizePicker } from './BoxSizePicker'

import type { AgentDevice } from '../../api'
import type { BoxSizeInfo } from '../../api/device-types'

/** The `/data` disk, which only grows: from its size now up to what instabox makes. */
function DiskField({
  info,
  value,
  disabled,
  onChange,
}: {
  info: BoxSizeInfo
  value: number | null
  disabled: boolean
  onChange: (value: number | null) => void
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-[12px] font-semibold text-main">{t('Disk')}</h3>
      <NumberField.Root
        value={value}
        min={info.diskGiB}
        max={info.maxDiskGiB}
        step={1}
        disabled={disabled}
        onValueChange={onChange}
      >
        <NumberField.Group className={`${fieldClass} flex h-9 w-40 items-center gap-2`}>
          <NumberField.Input
            aria-label={t('Disk size in GiB')}
            className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
          />
          <span className="text-[12px] text-tertiary">GiB</span>
        </NumberField.Group>
      </NumberField.Root>
      <p className="text-[11.5px] text-tertiary">{boxDiskHint(info)}</p>
    </section>
  )
}

/** Give a Box another size, a bigger disk or both; a running one restarts for it. */
export function BoxResizeDialog({
  teamId,
  device,
  onClose,
  onResized,
}: {
  teamId: string
  device: AgentDevice
  onClose: () => void
  onResized: () => void
}) {
  const [info, setInfo] = useState<BoxSizeInfo | null>(null)
  const [vcpus, setVcpus] = useState(0)
  const [disk, setDisk] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true

    api.boxSize(device.deviceId, teamId).then(
      (read) => {
        if (!live) return
        setInfo(read)
        setVcpus(read.vcpus)
        setDisk(read.diskGiB)
      },
      (error: unknown) => {
        if (!live) return
        toast.apiError(t('Could not read computer size'), error)
        onClose()
      },
    )

    return () => {
      live = false
    }
  }, [device.deviceId, teamId, onClose])

  const request = info && boxResizeRequest(info, vcpus, disk)
  const effect = BOX_RESIZE_EFFECT[info?.running ? 'restart' : 'nextStart'](device.label)
  const resize = async () => {
    if (!info || !request) return
    setSaving(true)
    try {
      await api.boxResize(device.deviceId, teamId, request)
      // A paused Box takes the size at its next start: there is no restart to follow.
      if (info.running) boxRestarts.start(device.deviceId, teamId, 'resize')
      onResized()
      onClose()
    } catch (error) {
      if (!openBoxPaywall(teamId, error, () => void resize()))
        toast.apiError(t('Could not resize computer'), error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Resize {name}', { name: device.label })}
      description={info ? boxCurrentSize(info) : undefined}
      width={560}
      footer={
        <div className="flex justify-end gap-2 px-5 py-3">
          <Button size="sm" variant="secondary" disabled={saving} onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" disabled={saving || !request} onClick={() => void resize()}>
            {saving ? t('Resizing…') : effect.confirmLabel}
          </Button>
        </div>
      }
    >
      {info ? (
        <div className="space-y-4 p-5">
          <section className="space-y-2">
            <h3 className="text-[12px] font-semibold text-main">{t('Size')}</h3>
            <BoxSizePicker
              choices={boxSizeChoices(info.sizes)}
              value={vcpus}
              // Every size the account offers is shown; the team's limit is the backend's to check.
              left={null}
              disabled={saving}
              onChange={setVcpus}
            />
          </section>
          <DiskField info={info} value={disk} disabled={saving} onChange={setDisk} />
          <p className="rounded-md bg-status-warning/10 px-3 py-2 text-[12px] text-secondary">
            {effect.note}
          </p>
        </div>
      ) : (
        <p className="flex items-center gap-2 p-5 text-[12.5px] text-secondary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t('Reading its size…')}
        </p>
      )}
    </Modal>
  )
}
