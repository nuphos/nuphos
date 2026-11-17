import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { useThisComputer } from '../../hooks/useThisComputer'
import { t } from '../../i18n'
import { agentTier } from '../../lib/agentName'
import { queryKeys } from '../../lib/query/keys'
import { quotaResetsLine } from '../../lib/runtimeQuota'

import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

/** The Claude limit resets an agent's account holds. Only that agent's own computer,
 *  signed in as its owner, can spend one: the sign-in lives there, and a reset
 *  cannot be undone, so it is asked for first. */
export function RuntimeResets({
  teamId,
  instance,
  quota,
}: {
  teamId: string
  instance: RuntimeInstance
  quota?: RuntimeQuota
}) {
  const thisComputer = useThisComputer()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const line = quotaResetsLine(quota)

  if (!line) return null
  const spendable =
    instance.provider === 'claude-code' &&
    quota?.resets?.usableNow === true &&
    agentTier(instance, thisComputer) === 'local'

  return (
    <div className="flex items-center justify-between gap-3 text-xs text-secondary">
      <span>{line}</span>
      {spendable && (
        <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
          {t('Use a reset')}
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        title={t('Use a Claude limit reset?')}
        description={t('This refills your Claude usage limits now. It cannot be undone.')}
        confirmLabel={t('Use a reset')}
        onConfirm={async () => {
          const outcome = await api.localRuntimeSpendClaudeReset(instance.local?.instanceId)

          if (outcome.result === 'reset') toast.success(t('Limits refilled'))
          else toast.error(t('Could not use a reset'))
          await queryClient.invalidateQueries({ queryKey: queryKeys.runtimeQuotas(teamId) })
        }}
        onClose={() => setConfirming(false)}
      />
    </div>
  )
}
