import clsx from 'clsx'
import { Plus } from 'lucide-react'

import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { relativeTimeFromNow } from '../../components/agent/panel/textUtils'
import { Button } from '../../components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { t } from '../../i18n'
import { AGENT_PROVIDER } from '../../types/runtime'

import { agentName, agentOffline, newAgentAction } from './agentPresentation'
import { accessHint, machineLine, seenFrom } from './boxPresentation'
import { PreviewTag } from './PreviewTag'
import { STATUS_DOT } from './runtimePresentation'

import type { AgentDevice } from '../../api'
import type { LocalAgentProvider } from '../../api/device-types'
import type { RuntimeInstance } from '../../types/runtime'

/** Open the same agent details panel as the usage table. */
export function AgentTile({ agent, onSelect }: { agent: RuntimeInstance; onSelect: () => void }) {
  const offline = agentOffline(agent)
  // Signed out after a sign-in, it stays on the card: its page is where it signs in again.
  const signedOut = agent.local?.signedIn === false
  let state = ''

  if (signedOut) state = ` · ${t('Sign in')}`
  if (offline) state = ` · ${t('Offline')}`
  const label = `${agentName(agent)}${state}`

  return (
    <li className="shrink-0">
      <button
        type="button"
        title={label}
        aria-label={t('Open {label} details', { label })}
        onClick={onSelect}
        className={`flex h-8 w-8 items-center justify-center rounded-lg bg-state-selected transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-focus ${offline || signedOut ? 'opacity-40 grayscale' : ''}`}
      >
        <AgentProviderIcon provider={agent.provider} className="h-4 w-4" />
      </button>
    </li>
  )
}

/** Whose a teammate's own computer is, under its status. Never a Box, which is the team's. */
export function OwnerLine({
  device,
  owner,
}: {
  device: AgentDevice
  owner: { name: string | null } | null
}) {
  return (
    owner &&
    !device.box && (
      <p className="mt-0.5 truncate text-[11.5px] leading-4 text-tertiary">
        {owner.name ? t('Shared by {name}', { name: owner.name }) : t('Shared by a teammate')}
      </p>
    )
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
      ? [
          line,
          `UID ${device.deviceId}`,
          device.lastSeenAt && t('Last online {when}', { when: away ?? t('now') }),
          seen,
        ]
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

const PROVIDERS: LocalAgentProvider[] = [
  'claude-code',
  'codex',
  'grok',
  'antigravity',
  'opencode',
  'dsh',
]

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
        aria-label={t('New runtime on {device}', { device: device.label })}
        title={t('New runtime')}
        render={<Button size="sm" variant="secondary" className="w-8 px-0" />}
      >
        <Plus className="h-3.5 w-3.5" />
      </MenuTrigger>
      <MenuContent align="start">
        {PROVIDERS.map((provider) => {
          const action = newAgentAction(agents, provider)
          const { label, preview } = AGENT_PROVIDER[provider]

          return (
            <MenuItem
              key={provider}
              disabled={busy || !action}
              icon={<AgentProviderIcon provider={provider} className="h-4 w-4" />}
              onClick={() => onAdd(provider)}
            >
              {provider === 'antigravity' && !action
                ? t('Antigravity uses this computer’s shared sign-in')
                : action && 'create' in action
                  ? label
                  : t('Sign in to {provider}', { provider: label })}
              {preview && <PreviewTag />}
            </MenuItem>
          )
        })}
        {!canAddAgents && (
          <MenuItem disabled>{t('Update the computer host to add more runtimes')}</MenuItem>
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
