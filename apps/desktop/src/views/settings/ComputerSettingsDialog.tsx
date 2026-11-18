import { createElement, useEffect, useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { MenuItem } from '../../components/ui/menu'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import type { AgentDevice } from '../../api'

/** The ⋯ menu's way into a computer's settings; shown once it has reported some, to whoever manages it. */
export function ComputerSettingsMenuItem({
  device,
  onOpen,
}: {
  device: AgentDevice
  onOpen: () => void
}) {
  if (device.autoInstall === undefined) return null

  return <MenuItem onClick={onOpen}>{t('Settings…')}</MenuItem>
}

/**
 * A computer's own settings. Its switch for installing updates by itself when idle is the same
 * one as Settings > Updates on a Desktop; the computer keeps it, so it changes only while the
 * computer is online, and offline the last value it reported is shown.
 */
export function ComputerSettingsDialog({
  open,
  device,
  teamId,
  onClose,
  onChanged,
}: {
  /** Kept mounted while closed, so the modal's close transition plays. */
  open: boolean
  device: AgentDevice
  teamId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [enabled, setEnabled] = useState(device.autoInstall !== false)
  const [saving, setSaving] = useState(false)

  // Each time it opens, the switch starts from what the computer reported.
  useEffect(() => {
    if (open) setEnabled(device.autoInstall !== false)
  }, [open, device.autoInstall])

  async function change(next: boolean) {
    setSaving(true)
    try {
      setEnabled((await api.deviceSetAutoInstall(device.deviceId, teamId, next)).enabled)
      onChanged()
    } catch (err) {
      toast.apiError(t('Could not change automatic updates'), err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Computer settings')}
      description={device.label}
      footer={
        <div className="flex justify-end px-5 py-3">
          <Button size="sm" onClick={onClose}>
            {t('Done')}
          </Button>
        </div>
      }
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-4 rounded-lg border border-line-control/70 bg-surface px-4 py-3.5">
          <div className="min-w-0">
            <div className="text-[13px] text-main">{t('Install updates automatically')}</div>
            <p className="mt-0.5 text-[12px] text-tertiary">
              {t(
                'Update Nuphos on this computer to the newest release once nothing has run on it for 10 minutes. The update restarts Nuphos on it.',
              )}
            </p>
            {!device.online && (
              <p className="mt-1.5 text-[12px] text-tertiary">
                {t('This computer is offline. It shows the last setting it reported.')}
              </p>
            )}
          </div>
          <Switch
            checked={enabled}
            disabled={!device.online || saving}
            label={t('Install updates automatically')}
            onChange={(next) => void change(next)}
          />
        </div>
      </div>
    </Modal>
  )
}

/** The menu item and the dialog it opens, for a computer's row. */
export function useComputerSettings(device: AgentDevice, teamId: string, onChanged: () => void) {
  const [open, setOpen] = useState(false)

  return {
    menuItem: createElement(ComputerSettingsMenuItem, { device, onOpen: () => setOpen(true) }),
    dialog: createElement(ComputerSettingsDialog, {
      open,
      device,
      teamId,
      onClose: () => setOpen(false),
      onChanged,
    }),
  }
}
