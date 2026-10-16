import { RadioGroup } from '@base-ui/react/radio-group'
import { Check, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { AgentProviderIcon } from '../../../components/agent/panel/icons'
import { Button } from '../../../components/ui/button'
import { AGENT_PROVIDER } from '../../../types/runtime'
import { RuntimeLoginBody } from '../../settings/RuntimeLoginBody'
import { boxSetupProblem } from '../../settings/boxPresentation'
import { useBoxSetup } from '../../settings/useBoxSetup'
import { useRuntimeLogin } from '../../settings/useRuntimeLogin'

import { RadioCard, SetupScreen } from './SetupChrome'

import type { RuntimeInstance } from '../../../types/runtime'

const BREADCRUMB = 'Cloud agent › Box'

function SignInPanel({
  teamId,
  instance,
  onBack,
  onConnected,
}: {
  teamId: string
  instance: RuntimeInstance
  onBack: () => void
  onConnected: (instance: RuntimeInstance) => void
}) {
  const state = useRuntimeLogin(teamId, instance, () => onConnected(instance))
  const account = AGENT_PROVIDER[instance.provider].account

  return (
    <SetupScreen
      breadcrumb={BREADCRUMB}
      title={`Sign in with ${account}`}
      subtitle={`${AGENT_PROVIDER[instance.provider].label} runs on your Box and keeps its own sign-in; Nuphos does not store it.`}
      hint="You can sign in later from Settings › Agents."
      actions={
        <>
          {state.failed && <Button onClick={state.restart}>Try again</Button>}
          <Button
            variant="ghost"
            disabled={state.closing}
            onClick={() => void state.cancel().then((left) => left && onBack())}
          >
            Back
          </Button>
        </>
      }
    >
      <ol className="space-y-4" role="status" aria-live="polite">
        <li className="flex items-center gap-2 text-[13px] text-secondary">
          {state.reachable ? (
            <Check className="h-4 w-4 text-success" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          {state.reachable ? 'Your agent is running' : 'Starting your agent…'}
        </li>
        {state.reachable && (
          <li className="space-y-4 rounded-xl border border-zGray-800 bg-zGray-900/60 p-4">
            <RuntimeLoginBody instance={instance} state={state} />
          </li>
        )}
      </ol>
    </SetupScreen>
  )
}

/** A Box: make the cloud computer, wait for its agents, pick one and sign it in without leaving the flow. */
export function BoxCloudSetup({
  teamId,
  deviceId,
  onCreated,
  onBack,
  onConnected,
}: {
  teamId: string
  /** The Box this flow made; owned by the flow so it outlives Back. */
  deviceId: string | null
  onCreated: (deviceId: string) => void
  onBack: () => void
  onConnected: (instance: RuntimeInstance) => void
}) {
  const box = useBoxSetup(teamId, deviceId, onCreated)
  const problem = boxSetupProblem(box.phase)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [instance, setInstance] = useState<RuntimeInstance | null>(null)
  const picked = box.agents.find((agent) => agent.id === pickedId) ?? box.agents[0]

  if (instance)
    return (
      <SignInPanel
        teamId={teamId}
        instance={instance}
        onBack={() => setInstance(null)}
        onConnected={onConnected}
      />
    )

  if (box.phase === 'ready')
    return (
      <SetupScreen
        breadcrumb={BREADCRUMB}
        title="Choose an agent"
        subtitle="Your Box is running. Pick the agent to sign in first; you can sign in the others later from Settings › Agents."
        actions={
          <>
            <Button variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button onClick={() => setInstance(picked)}>Continue</Button>
          </>
        }
      >
        <RadioGroup
          value={picked.id}
          onValueChange={(value: string) => setPickedId(value)}
          className="grid grid-cols-2 gap-3"
          aria-label="Agent"
        >
          {box.agents.map((agent) => (
            <RadioCard
              key={agent.id}
              value={agent.id}
              selected={picked.id === agent.id}
              icon={<AgentProviderIcon provider={agent.provider} className="h-4 w-4" />}
              title={AGENT_PROVIDER[agent.provider].label}
              description={`Sign in with ${AGENT_PROVIDER[agent.provider].account}`}
            />
          ))}
        </RadioGroup>
      </SetupScreen>
    )

  return (
    <SetupScreen
      breadcrumb={BREADCRUMB}
      title={box.phase === 'idle' ? 'Create a Box' : 'Starting your Box'}
      subtitle="A Box is a Linux computer in the cloud with Claude Code and Codex on it. Its agents keep working when this computer sleeps, and only you can use it."
      actions={
        <>
          <Button variant="ghost" disabled={box.creating} onClick={onBack}>
            Back
          </Button>
          {box.phase === 'idle' && (
            <Button disabled={box.creating} onClick={() => void box.create()}>
              {box.creating ? 'Creating…' : 'Create Box'}
            </Button>
          )}
        </>
      }
    >
      {box.phase !== 'idle' && (
        <ol className="space-y-3 text-[13px] text-secondary" role="status" aria-live="polite">
          <li className="flex items-center gap-2">
            <Check className="h-4 w-4 text-success" />
            Box created
          </li>
          <li className="flex items-center gap-2">
            {problem ? (
              <span className="h-2 w-2 rounded-full bg-red-500" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {problem ?? 'Starting the computer and its agents, usually 10–30 seconds…'}
          </li>
        </ol>
      )}
    </SetupScreen>
  )
}
