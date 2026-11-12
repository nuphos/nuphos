import { useSyncExternalStore } from 'react'

import { Modal } from '../../../components/Modal'
import { Button } from '../../../components/ui/button'
import { t } from '../../../i18n'
import { AddAgentDialog } from '../../settings/AddAgentDialog'

import { agentSetup } from './agentSetupStore'
import { LocalAgentSetupCards } from './LocalAgentsStep'

export function AgentSetupHost() {
  const request = useSyncExternalStore(agentSetup.subscribe, agentSetup.current)

  if (request?.kind === 'runtime')
    return <AddAgentDialog teamId={request.teamId} onClose={agentSetup.close} />
  if (!request) return null

  return (
    <Modal open title={t('Connect your agent')} width={600} onClose={agentSetup.close}>
      <div className="space-y-5 p-5">
        <p className="text-[13px] leading-relaxed text-secondary">
          {t(
            'Use Claude Code or Codex with the subscriptions you already have. Here’s what we found on this computer.',
          )}
        </p>
        <LocalAgentSetupCards />
        <div className="flex justify-end">
          <Button variant="secondary" onClick={agentSetup.close}>
            {t('Done')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
