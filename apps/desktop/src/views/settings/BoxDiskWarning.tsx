import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'

import { diskWarning } from './boxMetricsPresentation'

import type { AgentDevice } from '../../api'

/**
 * Under a computer whose disk is almost full: how little is left and what fills it, and for
 * whoever manages a running Box, the one fix that loses nothing.
 */
export function BoxDiskWarning({
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
          'Package caches, Docker images and conversation workspaces fill a disk over time. Agents fail once it is full.',
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
      <ConfirmDialog
        open={confirming}
        title={t('Clear caches on {boxLabel}?', { boxLabel: device.label })}
        description={t(
          'This removes the package and build caches that tools on {boxLabel} download or rebuild when they next need them: Go, Bun, pnpm, pip, uv and Docker’s build cache. Workspaces, sign-ins, Docker images and volumes are kept. The next installs and builds take longer, and a build running in a terminal right now may fail. It does not start while an agent on it is replying.',
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
        onClose={() => setConfirming(false)}
      />
    </div>
  )
}
