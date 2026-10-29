import clsx from 'clsx'
import { Plus } from 'lucide-react'

import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { relativeTimeFromNow } from '../../components/agent/panel/textUtils'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { AGENT_PROVIDER } from '../../types/runtime'

import { agentName, agentOffline } from './agentPresentation'
import { accessHint, machineLine, newAgentAction, seenFrom } from './boxPresentation'
import { STATUS_DOT } from './runtimePresentation'

import type { AgentDevice } from '../../api'
import type { LocalAgentProvider } from '../../api/device-types'
import type { RuntimeInstance } from '../../types/runtime'

export type BoxJoin = { token: string; expiresAt: string; apiUrl: string | null }

/** The two commands that make any Linux or macOS machine a Box of this user. */
export function JoinDialog({ join, onClose }: { join: BoxJoin; onClose: () => void }) {
  // Nuphos Cloud is the CLI's default; only another deployment (self-hosted, dev) names itself.
  const env = [
    join.apiUrl && join.apiUrl !== 'https://api.nuphos.ai' ? `NUPHOS_API_URL=${join.apiUrl}` : '',
    `NUPHOS_JOIN_TOKEN=${join.token}`,
  ]
    .filter(Boolean)
    .join(' ')
  const command = `curl -fsSL https://nuphos.ai/install | sh\n${env} nuphos agent`

  return (
    <Modal
      open
      onClose={onClose}
      title="Connect your own machine"
      description="Run this on the machine. The token works once and expires in an hour."
    >
      <div className="space-y-3 p-5">
        <pre className="whitespace-pre-wrap break-all rounded-lg border border-zGray-800 bg-main p-3 font-mono text-[12px] text-main">
          {command}
        </pre>
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void navigator.clipboard.writeText(command).then(() => toast.success('Copied'))
            }
          >
            Copy
          </Button>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Open the same agent details panel as the usage table. */
export function AgentTile({ agent, onSelect }: { agent: RuntimeInstance; onSelect: () => void }) {
  const offline = agentOffline(agent)
  // Signed out after a sign-in, it stays on the card: its page is where it signs in again.
  const signedOut = agent.local?.signedIn === false
  let state = ''

  if (signedOut) state = ' · Sign in'
  if (offline) state = ' · Offline'
  const label = `${agentName(agent)}${state}`

  return (
    <li className="shrink-0">
      <button
        type="button"
        title={label}
        aria-label={`Open ${label} details`}
        onClick={onSelect}
        className={`flex h-8 w-8 items-center justify-center rounded-lg bg-zGray-800/40 transition-colors hover:bg-zGray-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zViolet-500/60 ${offline || signedOut ? 'opacity-40 grayscale' : ''}`}
      >
        <AgentProviderIcon provider={agent.provider} className="h-4 w-4" />
      </button>
    </li>
  )
}

/** The green dot before a running Box or a live reading. */
export function LiveDot() {
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT.online}`} />
}

/** One short line after the status: the machine's kind, and when it was last seen if it is away. For a manager the
 * tooltip adds its UID and where it last reported from; Copy UID lives in its ⋯ menu. */
export function MachineLine({ device, dim }: { device: AgentDevice; dim: boolean }) {
  const seen = seenFrom(device)
  const away = device.lastSeenAt && !device.online ? relativeTimeFromNow(device.lastSeenAt) : null
  const line = away ? `${machineLine(device)} · ${away}` : machineLine(device)
  const details =
    device.access === 'manage'
      ? [line, `UID ${device.deviceId}`, device.lastSeenAt && `Last online ${away ?? 'now'}`, seen]
      : [line]

  return (
    <span
      className={clsx('truncate', dim && 'opacity-50')}
      title={details.filter(Boolean).join('\n')}
    >
      · {line}
    </span>
  )
}

const PROVIDERS: LocalAgentProvider[] = ['claude-code', 'codex', 'grok', 'opencode']

/** Add an agent to a machine; an older host can only sign in the agents it already has. */
export function NewAgentMenu({
  device,
  agents,
  busy,
  onAdd,
}: {
  device: AgentDevice
  agents: RuntimeInstance[]
  busy: boolean
  onAdd: (provider: LocalAgentProvider) => void
}) {
  // An older host cannot add agents; the backend still refuses with 409 if this is stale.
  const canAddAgents = agents.some((agent) => agent.local?.agentInstances === true)

  return (
    <Menu>
      <MenuTrigger
        aria-label={`New runtime on ${device.label}`}
        title="New runtime"
        render={<Button size="sm" variant="secondary" className="w-8 px-0" />}
      >
        <Plus className="h-3.5 w-3.5" />
      </MenuTrigger>
      <MenuContent align="start">
        {PROVIDERS.map((provider) => (
          <MenuItem
            key={provider}
            disabled={busy || !newAgentAction(agents, provider)}
            icon={<AgentProviderIcon provider={provider} className="h-4 w-4" />}
            onClick={() => onAdd(provider)}
          >
            {canAddAgents
              ? AGENT_PROVIDER[provider].label
              : `Sign in to ${AGENT_PROVIDER[provider].label}`}
          </MenuItem>
        ))}
        {!canAddAgents && (
          <MenuItem disabled>Update the computer host to add more runtimes</MenuItem>
        )}
      </MenuContent>
    </Menu>
  )
}

/** For a manager: who besides the admins may use this Box. */
export function AccessHint({ device }: { device: AgentDevice }) {
  const hint = accessHint(device)

  return hint && <span className="truncate text-[11px] text-tertiary">· {hint}</span>
}
