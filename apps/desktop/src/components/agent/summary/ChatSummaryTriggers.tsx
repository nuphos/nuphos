import { useState } from 'react'

import { t } from '../../../i18n'

import { SummarySection } from './ChatSummaryRows'
import { TriggerRow } from './TriggerRow'
import { useTriggers } from './useTriggers'

export function ChatSummaryTriggers({ teamId, sessionId }: { teamId: string; sessionId: string }) {
  const { triggers, loaded, error, pending, toggle } = useTriggers(teamId, sessionId)
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <SummarySection title={t('Triggers')}>
      {error && (
        <p role="alert" className="text-xs text-status-danger">
          {t('Could not update triggers. Try again.')}
        </p>
      )}
      {!loaded && !error && <p className="text-xs text-tertiary">{t('Loading…')}</p>}
      {loaded && triggers.length === 0 && (
        <p className="text-xs text-tertiary">{t('Ask here to schedule recurring work.')}</p>
      )}
      {triggers.map((trigger) => (
        <TriggerRow
          key={trigger.id}
          trigger={trigger}
          open={openId === trigger.id}
          busy={pending.has(trigger.id)}
          onToggleOpen={() => setOpenId((open) => (open === trigger.id ? null : trigger.id))}
          onToggle={(enabled) => void toggle(trigger, enabled)}
          askHint={t('Ask here to change this trigger.')}
        />
      ))}
    </SummarySection>
  )
}
