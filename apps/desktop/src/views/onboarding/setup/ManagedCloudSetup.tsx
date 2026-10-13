import { RadioGroup } from '@base-ui/react/radio-group'
import { Check, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../../api'
import { AgentProviderIcon } from '../../../components/agent/panel/icons'
import { Button } from '../../../components/ui/button'
import { toast } from '../../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../../hooks/useRuntimeInstances'
import { AGENT_PROVIDER, AGENT_PROVIDERS } from '../../../types/runtime'
import { RuntimeLoginBody } from '../../settings/RuntimeLoginBody'
import { useRuntimeLogin } from '../../settings/useRuntimeLogin'

import { managedRuntimePlan } from './agentSetup'
import { RadioCard, SetupScreen } from './SetupChrome'

import type { AgentProvider, RuntimeInstance } from '../../../types/runtime'

const BREADCRUMB = 'Cloud agent › Nuphos Cloud'

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
      subtitle={`${instance.label} runs in Nuphos Cloud and keeps its own sign-in; Nuphos does not store it.`}
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

/** Nuphos Cloud: pick the agent, create it, then sign it in without leaving the flow. */
export function ManagedCloudSetup({
  teamId,
  created,
  onCreatedChange,
  onBack,
  onConnected,
}: {
  teamId: string
  /** The agent this flow created and has not signed in yet; owned by the flow so it outlives Back. */
  created: RuntimeInstance | null
  onCreatedChange: (instance: RuntimeInstance | null) => void
  onBack: () => void
  onConnected: (instance: RuntimeInstance) => void
}) {
  const [provider, setProvider] = useState<AgentProvider>(created?.provider ?? 'claude-code')
  const [saving, setSaving] = useState(false)
  const [instance, setInstance] = useState<RuntimeInstance | null>(null)

  async function create() {
    if (saving) return
    const plan = managedRuntimePlan(created, provider)

    if (plan.kind === 'reuse') {
      setInstance(plan.instance)

      return
    }
    setSaving(true)
    try {
      // A different agent replaces the unsigned one, so the team is not left running both.
      if (plan.replace) {
        await api.atlasRemoveRuntimeInstance(teamId, plan.replace.id)
        onCreatedChange(null)
      }
      const next = await api.atlasCreateRuntimeInstance(teamId, { provider })

      onCreatedChange(next)
      setInstance(next)
    } catch (error) {
      toast.apiError('Could not add agent', error)
    } finally {
      window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
      setSaving(false)
    }
  }

  if (instance)
    return (
      <SignInPanel
        teamId={teamId}
        instance={instance}
        onBack={() => setInstance(null)}
        onConnected={onConnected}
      />
    )

  return (
    <SetupScreen
      breadcrumb={BREADCRUMB}
      title="Choose an agent"
      subtitle="Nuphos runs it for your workspace. You sign in with your own account next."
      actions={
        <>
          <Button variant="ghost" disabled={saving} onClick={onBack}>
            Back
          </Button>
          <Button disabled={saving} onClick={() => void create()}>
            {saving ? 'Adding…' : 'Continue'}
          </Button>
        </>
      }
    >
      <RadioGroup
        value={provider}
        onValueChange={(value: AgentProvider) => setProvider(value)}
        className="grid grid-cols-2 gap-3"
        aria-label="Agent"
      >
        {AGENT_PROVIDERS.map((option) => (
          <RadioCard
            key={option}
            value={option}
            selected={provider === option}
            icon={<AgentProviderIcon provider={option} className="h-4 w-4" />}
            title={AGENT_PROVIDER[option].label}
            description={`Sign in with ${AGENT_PROVIDER[option].account}`}
          />
        ))}
      </RadioGroup>
    </SetupScreen>
  )
}
