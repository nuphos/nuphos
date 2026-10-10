import { RadioGroup } from '@base-ui/react/radio-group'
import { ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api } from '../../../api'
import { Button } from '../../../components/ui/button'
import { useRuntimeInstances } from '../../../hooks/useRuntimeInstances'
import { useStableCallback } from '../../../hooks/useStableCallback'
import { ConnectAgentDialog } from '../../settings/ConnectAgentDialog'
import { ExternalRuntimeForm } from '../../settings/ExternalRuntimeForm'

import { newlyConnectedAgent } from './agentSetup'
import { SELF_HOSTED_PLATFORM_IDS, SELF_HOSTED_PLATFORMS } from './selfHostedPlatforms'
import { RadioCard, SetupScreen } from './SetupChrome'

import type { SelfHostedPlatform } from './selfHostedPlatforms'
import type { ConnectAgentLink } from '../../../lib/connectAgentLink'
import type { AtlasTeam } from '../../../types'
import type { AgentProvider } from '../../../types/runtime'
import type { ReactNode } from 'react'

const BREADCRUMB = 'Cloud agent › Self-hosted'

export type ConnectedCloudAgent = { provider: AgentProvider; label: string }

function DeployStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-xl border border-zGray-800 bg-zGray-900/60 px-4 py-3.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zGray-800 text-[12px] font-semibold text-secondary">
        {n}
      </span>
      <div className="min-w-0 space-y-2">
        <p className="text-[13.5px] font-medium text-main">{title}</p>
        <div className="text-[12.5px] leading-5 text-tertiary">{children}</div>
      </div>
    </li>
  )
}

/** Waits for the agent's console to hand it over: its Connect link, a typed pairing code, or the team list. */
function DeployAndConnect({
  teamId,
  teams,
  platform,
  onBack,
  onConnected,
}: {
  teamId: string
  teams: readonly AtlasTeam[]
  platform: SelfHostedPlatform
  onBack: () => void
  onConnected: (agent: ConnectedCloudAgent) => void
}) {
  const { name, url } = SELF_HOSTED_PLATFORMS[platform]
  const { instances, loading, refresh } = useRuntimeInstances(teamId)
  const [knownIds, setKnownIds] = useState<ReadonlySet<string>>()
  const [link, setLink] = useState<ConnectAgentLink | null>(null)
  const [pairing, setPairing] = useState(false)
  const connected = useStableCallback(onConnected)

  if (!loading && !knownIds) setKnownIds(new Set(instances.map((instance) => instance.id)))
  const joined = newlyConnectedAgent(knownIds, instances)

  useEffect(() => {
    if (joined) connected({ provider: joined.provider, label: joined.label })
  }, [joined, connected])

  useEffect(() => api.onConnectAgentDeepLink(setLink), [])

  return (
    <SetupScreen
      breadcrumb={BREADCRUMB}
      title={`Deploy on ${name}`}
      actions={
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      }
    >
      <ol className="space-y-3">
        <DeployStep n={1} title="Deploy the template">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-zViolet-500 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-zViolet-400"
          >
            Open {name} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </DeployStep>
        <DeployStep n={2} title="Open your agent’s console">
          Set a password, then sign in to Claude or ChatGPT there.
        </DeployStep>
        <DeployStep n={3} title="Press Connect to Nuphos">
          Nuphos picks it up here automatically.
        </DeployStep>
      </ol>
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-[13px] text-secondary" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Waiting for your agent to connect…
        </p>
        {pairing ? (
          <ExternalRuntimeForm
            onCancel={() => setPairing(false)}
            onPair={(input) => api.atlasPairExternalRuntime(teamId, input)}
            onConnected={(runtime) =>
              onConnected({ provider: runtime.provider, label: runtime.label ?? name })
            }
          />
        ) : (
          <button
            type="button"
            onClick={() => setPairing(true)}
            className="text-[12.5px] text-zViolet-400 hover:underline"
          >
            Use a pairing code instead
          </button>
        )}
      </div>
      {link && (
        <ConnectAgentDialog
          key={`${link.url}:${link.code}`}
          link={link}
          teams={teams}
          currentTeamId={teamId}
          onClose={() => setLink(null)}
          onConnected={() => {
            setLink(null)
            refresh()
          }}
        />
      )}
    </SetupScreen>
  )
}

/** Self-hosted: pick where it runs, deploy it there, and wait for it to connect. */
export function SelfHostedSetup({
  teamId,
  teams,
  onBack,
  onConnected,
}: {
  teamId: string
  teams: readonly AtlasTeam[]
  onBack: () => void
  onConnected: (agent: ConnectedCloudAgent) => void
}) {
  const [platform, setPlatform] = useState<SelfHostedPlatform>('zeabur')
  const [deploying, setDeploying] = useState(false)

  if (deploying)
    return (
      <DeployAndConnect
        teamId={teamId}
        teams={teams}
        platform={platform}
        onBack={() => setDeploying(false)}
        onConnected={onConnected}
      />
    )

  return (
    <SetupScreen
      breadcrumb={BREADCRUMB}
      title="Where do you want to run it?"
      actions={
        <>
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button onClick={() => setDeploying(true)}>Continue</Button>
        </>
      }
    >
      <RadioGroup
        value={platform}
        onValueChange={(value: SelfHostedPlatform) => setPlatform(value)}
        className="space-y-2"
        aria-label="Platform"
      >
        {SELF_HOSTED_PLATFORM_IDS.map((id) => (
          <RadioCard
            key={id}
            value={id}
            selected={platform === id}
            title={SELF_HOSTED_PLATFORMS[id].name}
            description={SELF_HOSTED_PLATFORMS[id].tag}
          />
        ))}
      </RadioGroup>
    </SetupScreen>
  )
}
