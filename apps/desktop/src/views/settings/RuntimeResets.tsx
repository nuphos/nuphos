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
import { quotaResetsLine, resetKindLabel, resetOutcomeError } from '../../lib/runtimeQuota'

import type { RuntimeInstance, RuntimeQuota } from '../../types/runtime'

/** The Claude limit resets an agent's account holds. Others see the count; the agent's
 *  own computer, signed in as its owner, opts in (they are read from an unofficial
 *  Anthropic API) and can spend one, which cannot be undone, so it asks first. */
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
  const [asking, setAsking] = useState<'on' | 'spend' | null>(null)
  const [busy, setBusy] = useState(false)
  const line = quotaResetsLine(quota)
  const resets = quota?.available ? quota.resets : undefined
  const mine = instance.provider === 'claude-code' && agentTier(instance, thisComputer) === 'local'

  if (!mine) return line ? <p className="text-xs text-secondary">{line}</p> : null
  const run = async (action: 'on' | 'off' | 'spend') => {
    setBusy(true)
    try {
      const outcome = await api.localRuntimeClaudeResets(action, instance.local?.instanceId)
      const error = resetOutcomeError(outcome.result)

      if (outcome.result === 'reset') toast.success(t('Limits refilled'))
      else if (error)
        toast.error(
          action === 'spend' ? t('Could not use a reset') : t('Could not change limit resets'),
          error,
        )
      await queryClient.invalidateQueries({ queryKey: queryKeys.runtimeQuotas(teamId) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 text-xs text-secondary">
      <span>{resets ? (line ?? t('No limit resets')) : t('Limit resets are off')}</span>
      <span className="flex items-center gap-2">
        {resets?.usableNow && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => setAsking('spend')}>
            {t('Use a reset')}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => (resets ? void run('off') : setAsking('on'))}
        >
          {resets ? t('Turn off') : t('Show limit resets')}
        </Button>
      </span>
      <ConfirmDialog
        open={asking === 'on'}
        title={t('Show Claude limit resets?')}
        description={t(
          'Nuphos reads them, and spends one when you ask, through an unofficial Anthropic API, sending its requests as Claude Code. Anthropic may change it at any time, and using it may affect your Claude account.',
        )}
        confirmLabel={t('Show limit resets')}
        onConfirm={() => run('on')}
        onClose={() => setAsking(null)}
      />
      <ConfirmDialog
        open={asking === 'spend'}
        title={t('Use a Claude limit reset?')}
        description={
          <>
            {resetKindLabel(resets?.kind ?? null)} ·{' '}
            {t('{count} left', { count: resets?.left ?? 0 })}
            <br />
            {t('This refills your Claude usage limits now. It cannot be undone.')}
          </>
        }
        destructive
        confirmLabel={t('Use a reset')}
        onConfirm={() => run('spend')}
        onClose={() => setAsking(null)}
      />
    </div>
  )
}
