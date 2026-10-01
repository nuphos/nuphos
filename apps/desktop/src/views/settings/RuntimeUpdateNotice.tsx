import { useState } from 'react'

import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'

import { runtimeUpdatePresentation } from './runtimeUpdatePresentation'

import type { RuntimeUpdateStatus } from '../../types/team'

export function RuntimeUpdateNotice({
  update,
  managed,
  canUpdate,
  enabled,
  onUpdate,
}: {
  update?: RuntimeUpdateStatus
  managed: boolean
  canUpdate: boolean
  enabled: boolean
  onUpdate: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  if (!update || update.state === 'current') return null
  const view = runtimeUpdatePresentation(update, managed, canUpdate, enabled)

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-t border-zGray-800/60 px-4 py-3"
      role="status"
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-main">
          {view.title}
          {view.version && update.state !== 'unknown' && ` · v${view.version}`}
        </p>
        <p className="mt-1 text-xs text-secondary">{view.detail}</p>
        <a
          className="mt-1 inline-block text-xs text-zViolet-400 hover:underline"
          href={update.releaseUrl}
          target="_blank"
          rel="noreferrer"
        >
          View changelog
        </a>
      </div>
      {view.showButton && (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || view.pending}
          onClick={() => {
            setBusy(true)
            void onUpdate()
              .catch((error: unknown) => toast.apiError('Could not update runtime', error))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Requesting…' : view.button}
        </Button>
      )}
    </div>
  )
}
