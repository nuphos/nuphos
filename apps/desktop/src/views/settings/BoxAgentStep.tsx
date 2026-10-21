import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { Button } from '../../components/ui/button'
import { AGENT_PROVIDER } from '../../types/runtime'

import { Choice } from './AddAgentChoice'
import { boxSetupProblem } from './boxPresentation'
import { NEW_BOX_DESCRIPTION, NEW_BOX_FORM, NewBoxFields } from './NewBoxFields'
import { StepActions } from './StepActions'
import { useBoxSetup } from './useBoxSetup'
import { useBoxUsage } from './useBoxUsage'
import { useNewBox } from './useNewBox'

import type { RuntimeInstance } from '../../types/runtime'

/** Makes a Box with New Box's form, waits for its agents, then hands the chosen one to sign-in. */
export function BoxAgentForm({
  teamId,
  footer,
  onCloseGuard,
  onBack,
  onChosen,
}: {
  teamId: string
  footer: HTMLElement | null
  /** Hands the dialog whether it may close now: not while creating, nor on an Escape meant for the plans. */
  onCloseGuard: (canClose: (() => boolean) | null) => void
  onBack: () => void
  onChosen: (instance: RuntimeInstance) => void
}) {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const box = useBoxSetup(teamId, deviceId, setDeviceId)
  const { usage, reload: reloadUsage } = useBoxUsage(teamId)
  const newBox = useNewBox({ teamId, usage, labels: box.labels, onCreated: setDeviceId })
  const { creating, canClose } = newBox

  useEffect(() => {
    onCloseGuard(canClose)

    return () => onCloseGuard(null)
  })

  const button =
    'rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60 disabled:opacity-50'

  return (
    <div className="space-y-4">
      {box.phase === 'idle' && (
        <>
          <p className="text-[12.5px] leading-5 text-secondary">{NEW_BOX_DESCRIPTION}</p>
          <NewBoxFields box={newBox} className="space-y-5" onPlanChanged={reloadUsage} />
        </>
      )}
      {box.phase === 'ready' && (
        <div className="space-y-2">
          <p className="text-[12.5px] text-secondary">
            Your Box is running. Choose an agent to sign in.
          </p>
          {box.agents.map((agent) => (
            <Choice
              key={agent.id}
              icon={<AgentProviderIcon provider={agent.provider} className="h-4 w-4" />}
              title={AGENT_PROVIDER[agent.provider].label}
              description={`Sign in with ${AGENT_PROVIDER[agent.provider].account}.`}
              onClick={() => onChosen(agent)}
            />
          ))}
        </div>
      )}
      {box.phase !== 'idle' && box.phase !== 'ready' && (
        <p className="flex items-center gap-2 text-[12.5px] leading-5 text-secondary" role="status">
          {box.phase === 'starting' && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
          {box.phase === 'starting' &&
            'Starting the computer and its agents, usually 10 to 30 seconds…'}
          {boxSetupProblem(box.phase)}
        </p>
      )}
      <StepActions footer={footer} className="flex items-center justify-end gap-2">
        <button type="button" onClick={onBack} disabled={creating} className={button}>
          Back
        </button>
        {box.phase === 'idle' && (
          <Button size="sm" type="submit" form={NEW_BOX_FORM} disabled={creating}>
            {creating ? 'Creating…' : 'Create Box'}
          </Button>
        )}
      </StepActions>
    </div>
  )
}
