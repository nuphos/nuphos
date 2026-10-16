import clsx from 'clsx'
import { Laptop, Monitor, Plus } from 'lucide-react'

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

/** What kind of machine this is, drawn the way people recognise it. */
export function MachineIcon({ device }: { device: AgentDevice }) {
  const model = device.model ?? ''

  if (device.box)
    return (
      // instabox's mark: a Box is an instabox machine.
      <svg viewBox="0 0 32 32" className="h-5 w-5" aria-label="instabox">
        <rect width="32" height="32" rx="7" fill="#000" />
        <path
          transform="translate(4.39 2.92) scale(0.82)"
          fill="#fff"
          d="M15.38 0L1.96 8.88C1.49 9.19 0.87 9.03 0.59 8.54C0.3 8.05 0.49 7.43 1 7.2L15.38 0ZM28.56 22.3L15.58 31.43C14.91 31.9 13.96 31.72 13.54 30.97C13.13 30.25 13.41 29.32 14.16 28.98L28.56 22.3ZM28.56 18.55L15.58 27.69C14.91 28.15 13.96 27.97 13.54 27.23C13.13 26.5 13.41 25.57 14.16 25.24L28.56 18.55ZM28.56 14.81L15.58 23.95C14.91 24.41 13.96 24.23 13.54 23.48C13.13 22.76 13.41 21.83 14.16 21.5L28.56 14.81ZM28.56 11.1L15.58 20.23C14.91 20.7 13.96 20.52 13.54 19.77C13.13 19.05 13.41 18.12 14.16 17.78L28.56 11.1ZM28.3 7.48L15.56 16.46C14.89 16.95 13.93 16.75 13.52 16.03C13.11 15.3 13.39 14.37 14.16 14.04L28.33 7.48H28.3ZM25.08 5.63L11.66 14.48C11.2 14.79 10.58 14.63 10.29 14.14C10.01 13.65 10.19 13.03 10.71 12.8L25.08 5.63ZM21.83 3.74L8.41 12.59C7.94 12.9 7.32 12.75 7.04 12.26C6.76 11.77 6.94 11.15 7.45 10.92L21.83 3.74ZM18.6 1.88L5.18 10.74C4.72 11.05 4.1 10.89 3.81 10.4C3.53 9.91 3.71 9.29 4.23 9.06L18.6 1.88ZM13.52 27.23L10.19 29.68C9.96 29.83 9.65 29.78 9.52 29.52C9.39 29.29 9.49 28.98 9.72 28.88L13.49 27.23H13.52ZM13.52 23.51L6.99 27.85C6.76 28 6.45 27.92 6.29 27.69C6.16 27.46 6.24 27.15 6.5 27.02C6.5 27.02 13.52 23.51 13.52 23.54V23.51ZM13.52 19.77L3.74 25.99C3.51 26.14 3.2 26.06 3.04 25.81C2.89 25.57 2.99 25.24 3.25 25.11C3.25 25.11 13.52 19.74 13.52 19.77ZM13.52 16.03L0.77 23.97C0.54 24.13 0.2 24.05 0.07 23.79C-0.08 23.56 0.02 23.23 0.28 23.1L13.54 16.03H13.52ZM10.29 14.14L0.77 20.23C0.54 20.39 0.23 20.31 0.07 20.05C-0.08 19.82 0.02 19.48 0.28 19.35L10.29 14.14ZM7.04 12.28L0.74 16.49C0.51 16.65 0.2 16.57 0.05 16.34H0.07C-0.06 16.1 0.02 15.79 0.28 15.66L7.07 12.31L7.04 12.28ZM3.81 10.43L0.74 12.72C0.54 12.88 0.2 12.83 0.07 12.59C-0.06 12.36 0.05 12.05 0.28 11.95L3.81 10.43Z"
        />
      </svg>
    )
  if (/MacBook|Laptop/iu.test(model)) return <Laptop className="h-4 w-4 text-secondary" />
  if (/Mac mini|Mac Studio/iu.test(model))
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 text-secondary"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden
      >
        <rect x="3" y="8" width="18" height="8" rx="2.5" />
        <circle cx="7" cy="12" r="0.9" fill="currentColor" stroke="none" />
      </svg>
    )

  return <Monitor className="h-4 w-4 text-secondary" />
}

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
  const label = `${agentName(agent)}${offline ? ' · Offline' : ''}`

  return (
    <li className="shrink-0">
      <button
        type="button"
        title={label}
        aria-label={`Open ${label} details`}
        onClick={onSelect}
        className={`flex h-10 w-10 items-center justify-center rounded-lg bg-zGray-800/40 transition-colors hover:bg-zGray-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zViolet-500/60 ${offline ? 'opacity-40 grayscale' : ''}`}
      >
        <AgentProviderIcon provider={agent.provider} className="h-5 w-5" />
      </button>
    </li>
  )
}

/** The green dot before a running Box or a live reading. */
export function LiveDot() {
  return <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT.online}`} />
}

/** The machine's kind; for a manager also its UID and when and where it was last online. */
export function MachineLine({
  device,
  thisComputer,
  dim,
}: {
  device: AgentDevice
  thisComputer: boolean
  dim: boolean
}) {
  const seen = seenFrom(device)
  const lastOnline =
    device.lastSeenAt && (device.online ? 'now' : relativeTimeFromNow(device.lastSeenAt))
  const copy = () =>
    navigator.clipboard.writeText(device.deviceId).then(
      () => toast.success('UID copied'),
      () => toast.error('Could not copy the UID'),
    )

  return (
    <div
      className={clsx('mt-1 shrink-0 text-[11.5px] leading-4 text-tertiary', dim && 'opacity-50')}
    >
      <div className="truncate" title={machineLine(device)}>
        {thisComputer ? 'This computer' : machineLine(device)}
      </div>
      {device.access === 'manage' && (
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            title={`Copy UID ${device.deviceId}`}
            className="shrink-0 font-mono hover:text-main"
            onClick={() => void copy()}
          >
            UID {device.deviceId.slice(0, 8)}
          </button>
          {lastOnline && (
            <span className="truncate" title={seen ?? undefined}>
              · Last online: {lastOnline}
              {seen && ` · ${seen}`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

const PROVIDERS: LocalAgentProvider[] = ['claude-code', 'codex']

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
        aria-label={`New agent on ${device.label}`}
        render={<Button size="sm" variant="secondary" className="h-10" />}
      >
        <Plus className="h-3.5 w-3.5" />
        New Agent
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
        {!canAddAgents && <MenuItem disabled>Update the Box host to add more agents</MenuItem>}
      </MenuContent>
    </Menu>
  )
}

/** For a manager: who besides the admins may use this Box. */
export function AccessHint({ device }: { device: AgentDevice }) {
  const hint = accessHint(device)

  return hint && <span className="shrink-0 text-[11px] text-tertiary">{hint}</span>
}
