import { FolderOpen } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { MenuItem } from '../../components/ui/menu'
import { Switch } from '../../components/ui/Switch'
import { toast } from '../../components/ui/toast'
import { useLocalRuntimeState } from '../../hooks/useLocalRuntimeState'
import { useThisComputer } from '../../hooks/useThisComputer'
import { t } from '../../i18n'

import { OpenAtLoginSettings } from './OpenAtLoginSettings'
import { SleepPreventionSettings } from './SleepPreventionSettings'

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

const CARD = 'rounded-lg border border-line-control/70 bg-surface'

/** Where this computer's local agents keep their files. */
function WorkspaceFolder() {
  const workspace = useLocalRuntimeState()?.workspace

  if (!workspace) return null

  return (
    <div className={`${CARD} flex items-center justify-between gap-4 px-4 py-3`}>
      <div className="min-w-0">
        <div className="text-[13px] text-main">{t('Workspace folder')}</div>
        <div className="truncate text-[12px] text-tertiary" title={workspace}>
          {workspace}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={() => void api.localRuntimeOpenWorkspace()}>
        <FolderOpen strokeWidth={1.5} className="mr-1.5 h-3.5 w-3.5" />
        {t('Open')}
      </Button>
    </div>
  )
}

/**
 * A computer's own settings. Its switch for installing updates by itself when idle is the same
 * one as Settings > Updates on a Desktop; the computer keeps it, so it changes only while the
 * computer is online, and offline the last value it reported is shown. On the computer itself
 * it also holds the settings only this Desktop can change: opening at login, staying awake and
 * its workspace folder.
 */
export function ComputerSettingsDialog({
  open,
  device,
  teamId,
  onClose,
  onChanged,
}: {
  /** Kept mounted while closed, so the modal's close transition plays; each opening is a new
   *  instance (useComputerSettings), so the switch starts from what the computer reported. */
  open: boolean
  device: AgentDevice
  teamId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [enabled, setEnabled] = useState(device.autoInstall !== false)
  const [saving, setSaving] = useState(false)
  const here = useThisComputer()?.deviceId === device.deviceId

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
      <div className="space-y-3 p-5">
        {here && <OpenAtLoginSettings />}
        <div className={`${CARD} flex items-start justify-between gap-4 px-4 py-3.5`}>
          <div className="min-w-0">
            <div className="text-[13px] text-main">{t('Install updates automatically')}</div>
            <p className="mt-0.5 text-[12px] text-tertiary">
              {t(
                'Update Nuphos on this computer to the newest release when nothing is running on it. The update restarts Nuphos on it.',
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
        {here && (
          <>
            <SleepPreventionSettings />
            <WorkspaceFolder />
          </>
        )}
      </div>
    </Modal>
  )
}
