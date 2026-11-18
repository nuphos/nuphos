import { Box } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { Modal } from '../../../components/Modal'
import { Button } from '../../../components/ui/button'
import { t } from '../../../i18n'
import { Choice } from '../../settings/AddAgentChoice'
import { AddAgentDialog } from '../../settings/AddAgentDialog'
import { CLOUD_COMPUTER_DESCRIPTION } from '../../settings/boxCreatePresentation'

import { agentSetup, openAddRuntime } from './agentSetupStore'
import { LocalAgentSetupCards } from './LocalAgentsStep'

export function AgentSetupHost() {
  const request = useSyncExternalStore(agentSetup.subscribe, agentSetup.current)

  if (request?.kind === 'runtime')
    return (
      <AddAgentDialog
        teamId={request.teamId}
        onClose={agentSetup.close}
        onBoxCreated={request.onBoxCreated}
      />
    )
  if (!request) return null
  const { cloud } = request

  return (
    <Modal open title={t('Connect a runtime')} width={600} onClose={agentSetup.close}>
      <div className="space-y-5 p-5">
        <p className="text-[13px] leading-relaxed text-secondary">
          {t(
            'Use Claude Code or Codex with the subscriptions you already have. Here’s what we found on this computer.',
          )}
        </p>
        <LocalAgentSetupCards />
        {cloud && (
          <Choice
            icon={<Box className="h-4 w-4" />}
            title={t('Nuphos cloud computer')}
            description={CLOUD_COMPUTER_DESCRIPTION}
            onClick={() => openAddRuntime(cloud.teamId, cloud.onBoxCreated)}
          />
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={agentSetup.close}>
            {t('Done')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
