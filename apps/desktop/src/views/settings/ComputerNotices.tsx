import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { canManage } from './agentPresentation'
import { diskWarning, memoryWarning, pressureWarning } from './boxMetricsPresentation'
import { providerPause } from './boxPresentation'
import { outdatedNotice } from './computerOutdated'

import type { AgentDevice } from '../../api'

/** Under a computer: what will fail its agents, most certain first, and what to do about each. */
export function ComputerNotices({
  teamId,
  device,
  here,
  running,
}: {
  teamId: string
  device: AgentDevice
  /** The computer this app runs on. */
  here: boolean
  running: boolean
}) {
  const outdated = outdatedNotice(device, here)
  const paused = providerPause(device)
  const memory = memoryWarning(device)
  const pressure = pressureWarning(device)

  return (
    <>
      {paused && (
        <p role="status" className="mt-2 text-[11.5px] leading-4 text-tertiary">
          {paused}
        </p>
      )}
      {[outdated, pressure, memory].map(
        (notice) =>
          notice && (
            <div key={notice.text} role="status" className="mt-2 text-[11.5px] leading-4">
              <p className="flex items-center gap-1 text-warning">
                <TriangleAlert aria-hidden className="h-3 w-3 shrink-0" />
                {notice.text}
              </p>
              <p className="mt-0.5 text-tertiary">{notice.hint}</p>
            </div>
          ),
      )}
      <DiskWarning
        teamId={teamId}
        device={device}
        clearable={Boolean(device.box) && canManage(device) && running}
      />
    </>
  )
}

/**
 * A disk that is almost full: how little is left and what fills it, and for whoever manages a
 * running Box, the one fix that loses nothing.
 */
function DiskWarning({
  teamId,
  device,
  clearable,
}: {
  teamId: string
  device: AgentDevice
  /** A running Box the viewer manages; anyone's own computer is theirs to tidy. */
  clearable: boolean
}) {
  const warning = diskWarning(device)
  const [confirming, setConfirming] = useState(false)

  if (!warning) return null

  return (
    <div role="status" className="mt-2 text-[11.5px] leading-4">
      <p className="flex items-center gap-1 text-warning">
        <TriangleAlert aria-hidden className="h-3 w-3 shrink-0" />
        {warning.text}
      </p>
      <p className="mt-0.5 text-tertiary">
        {t(
          'Package caches, Docker images and conversation workspaces fill a disk over time. Bots and tasks fail once it is full.',
        )}
      </p>
      {clearable && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-1.5"
          onClick={() => setConfirming(true)}
        >
          {t('Clear caches')}
        </Button>
      )}
      <ClearCachesConfirm
        teamId={teamId}
        device={device}
        open={confirming}
        onClose={() => setConfirming(false)}
      />
    </div>
  )
}

/** The confirmation before clearing a Box's caches: from its card, or the conversation's banner. */
export function ClearCachesConfirm({
  teamId,
  device,
  open,
  onClose,
}: {
  teamId: string
  device: Pick<AgentDevice, 'deviceId' | 'label'>
  open: boolean
  onClose: () => void
}) {
  return (
    <ConfirmDialog
      open={open}
      title={t('Clear caches on {boxLabel}?', { boxLabel: device.label })}
      description={t(
        'This removes the package and build caches that tools on {boxLabel} download or rebuild when they next need them: Go, Bun, pnpm, pip, uv and Docker’s build cache. Workspaces, sign-ins, Docker images and volumes are kept. The next installs and builds take longer. Running Tasks aren’t stopped, but a build or install in progress may fail and need to run again.',
        { boxLabel: device.label },
      )}
      confirmLabel={t('Clear caches')}
      onConfirm={async () => {
        try {
          await api.boxClearCaches(device.deviceId, teamId)
          toast.success(
            t('Clearing caches on {boxLabel}', { boxLabel: device.label }),
            t('Its disk reading drops as space is freed.'),
          )
        } catch (error) {
          toast.apiError(t('Could not clear caches'), error)
        }
      }}
      onClose={onClose}
    />
  )
}
