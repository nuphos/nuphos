import { useState } from 'react'

import { api } from '../../../api'
import { t } from '../../../i18n'
import { TriggerRemoveWithoutCleanupDialog } from '../../../views/triggers/TriggerRemoveWithoutCleanupDialog'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import type { AgentTrigger, DeleteAgentTriggerResult } from '../../../api/agent-trigger-types'

export function ChatSummaryTriggerRecovery({
  trigger,
  teamId,
  onUpdated,
}: {
  trigger: AgentTrigger
  teamId: string
  onUpdated: (result: DeleteAgentTriggerResult) => void
}) {
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState<AgentTrigger | null>(null)

  if (trigger.cleanupStatus !== 'cleanup_failed') return null

  async function remove(withoutProviderCleanup = false) {
    setBusy(true)
    try {
      onUpdated(await api.agentDeleteTrigger(trigger.id, teamId, withoutProviderCleanup))
      setLoaded(null)
    } catch (error) {
      toast.apiError(t('Could not remove {name}', { name: trigger.name }), error)
    } finally {
      setBusy(false)
    }
  }

  async function previewRemoval() {
    setBusy(true)
    try {
      setLoaded(await api.agentGetTrigger(trigger.id, teamId))
    } catch (error) {
      toast.apiError(t('Could not remove {name}', { name: trigger.name }), error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs text-status-danger">
        {trigger.cleanupError ?? t('Provider cleanup failed')}
      </p>
      {trigger.canDelete && (
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove()}>
            {t('Retry cleanup')}
          </Button>
          {trigger.cleanupErrorCode === 'provider_integration_disconnected' && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void previewRemoval()}>
              {t('Remove without provider cleanup')}
            </Button>
          )}
        </div>
      )}
      <TriggerRemoveWithoutCleanupDialog
        open={loaded !== null}
        loaded={loaded}
        onClose={() => setLoaded(null)}
        onConfirm={() => remove(true)}
      />
    </div>
  )
}
