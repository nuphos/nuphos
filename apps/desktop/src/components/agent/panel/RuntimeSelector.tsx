import { ChevronDown, Plus, Settings2 } from 'lucide-react'

import { useAgentUpdates } from '../../../hooks/useAgentUpdates'
import { useThisComputer } from '../../../hooks/useThisComputer'
import { agentName, groupAgentsByTier, listedAgents } from '../../../lib/agentName'
import { quotaSignedOut } from '../../../lib/runtimeQuota'
import { AGENT_PROVIDER } from '../../../types/runtime'
import { RuntimeUsageBar } from '../../../views/settings/RuntimeUsageBar'
import { ConfirmDialog } from '../../ConfirmDialog'
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from '../../ui/menu'

import { AgentUpdateBadge } from './AgentUpdateBadge'
import { AgentProviderIcon } from './icons'
import { selectedAgentReachability } from './runtimeControlSignOut'

import type { RuntimeInstance, RuntimeQuota } from '../../../types/runtime'

export type RuntimeControl = {
  /** Lets the selector ask each agent whether an update is available. */
  teamId?: string
  /** A team agent's update can be started from the list. */
  canUpdateTeamAgents?: boolean
  value: {
    id?: string
    provider: RuntimeInstance['provider']
    label: string
    status?: RuntimeInstance['status']
  } | null
  options?: RuntimeInstance[]
  /** Provider usage per runtime id, for the trigger and the list. */
  quotas?: ReadonlyMap<string, RuntimeQuota>
  /** Picks the agent: the one a new conversation starts on, or — for an open
   *  conversation — the one it moves to. */
  onSelect?: (runtimeId: string) => void
  /** Nothing can be picked right now (a turn is streaming, or a move is in flight). */
  selectDisabled?: boolean
  /** The runtime this conversation is bound to is disabled or gone. */
  unavailable?: boolean
  loading?: boolean
  error?: string | null
  onSettings?: () => void
  /** New conversation: add a team agent in place, without leaving the conversation. */
  onAddAgent?: () => void
  /** A pick that needs the user's go-ahead before it takes effect. */
  confirm?: {
    title: string
    description: string
    confirmLabel: string
    onConfirm: () => void
    onCancel: () => void
  }
}

const AGENT_DOT = {
  ready: { color: 'bg-success', label: 'Box online · agent ready' },
  signIn: { color: 'bg-warning', label: 'Box online · agent needs sign-in' },
  offline: { color: 'bg-error', label: 'Box offline' },
} as const

function runtimeOptionNote(instance: RuntimeInstance, quota?: RuntimeQuota): string {
  if (instance.deletion) return ' · Being removed'
  if (instance.starting) return ' · Starting…'
  if (quotaSignedOut(quota)) return ' · Sign in required'

  return ''
}

export function RuntimeSelector({
  menuOpen,
  onMenuOpenChange,
  teamId,
  canUpdateTeamAgents,
  value,
  options = [],
  quotas,
  onSelect,
  selectDisabled,
  unavailable,
  loading,
  error,
  onSettings,
  onAddAgent,
  confirm,
}: RuntimeControl & {
  /** Lets the composer open the list, e.g. from the agent-status banner. */
  menuOpen?: boolean
  onMenuOpenChange?: (open: boolean) => void
}) {
  const providerName = AGENT_PROVIDER[value?.provider ?? 'claude-code'].label
  const owner = useThisComputer()
  const selected = value?.id ? options.find((instance) => instance.id === value.id) : undefined
  const listed = listedAgents(options)
  const label = value
    ? agentName(selected ?? { ...(value.id ? { id: value.id } : {}), label: value.label }, owner)
    : loading
      ? 'Loading agents…'
      : 'Choose agent'
  const updates = useAgentUpdates(teamId, options, canUpdateTeamAgents)
  const reachability = selectedAgentReachability({ value, options })
  const dot = reachability ? AGENT_DOT[reachability] : null
  const content = (
    <>
      <AgentProviderIcon provider={value?.provider} className="h-3.5 w-3.5 shrink-0" />
      {loading && !value ? (
        <span
          aria-label="Loading agent"
          role="status"
          className="h-3 w-16 rounded bg-zGray-700/60 animate-pulse motion-reduce:animate-none"
        />
      ) : (
        <span className="min-w-0 max-w-40 truncate">{label}</span>
      )}
      {dot && (
        <span
          role="img"
          aria-label={dot.label}
          title={dot.label}
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot.color}`}
        />
      )}
      {unavailable && <span className="shrink-0 text-amber-400">· Unavailable</span>}
    </>
  )
  const classes =
    'hidden h-7 min-w-0 max-w-fit grow basis-24 items-center gap-1.5 overflow-hidden rounded-full px-2 text-[12px] text-secondary @[230px]:flex'

  if (!onSelect)
    return (
      <span className={classes} title={`${label} · ${providerName}`}>
        {content}
      </span>
    )

  return (
    <>
      {confirm && (
        <ConfirmDialog
          open
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.confirmLabel}
          onConfirm={confirm.onConfirm}
          onClose={confirm.onCancel}
        />
      )}
      <Menu open={menuOpen} onOpenChange={onMenuOpenChange}>
        <MenuTrigger
          aria-label={`Conversation agent: ${label}`}
          className={`${classes} transition-colors hover:bg-zGray-800/60 hover:text-main`}
        >
          {content}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </MenuTrigger>
        <MenuContent side="top" align="end" className="w-72">
          {error && <p className="px-2 py-2 text-xs text-error">{error}</p>}
          {!loading && !error && listed.length === 0 && (
            <p className="px-2 py-2 text-xs text-tertiary">
              Connect an agent in Settings → Agent to get started.
            </p>
          )}
          <div className="max-h-64 overflow-auto">
            {groupAgentsByTier(listed, owner).map((group, index) => (
              <MenuGroup key={group.tier}>
                {index > 0 && <MenuSeparator />}
                {group.title && <MenuGroupLabel>{group.title}</MenuGroupLabel>}
                {group.agents.map((instance) => {
                  const update = updates.get(instance.id)

                  return (
                    <MenuItem
                      key={instance.id}
                      selected={instance.id === value?.id}
                      disabled={selectDisabled || Boolean(instance.deletion)}
                      icon={
                        <AgentProviderIcon provider={instance.provider} className="h-3.5 w-3.5" />
                      }
                      onClick={() => onSelect(instance.id)}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate">{agentName(instance, owner)}</span>
                          {update && <AgentUpdateBadge update={update} actionable />}
                        </span>
                        <span className="flex items-center gap-1.5 text-[11px] text-tertiary">
                          {AGENT_PROVIDER[instance.provider].label}
                          {runtimeOptionNote(instance, quotas?.get(instance.id))}
                          <RuntimeUsageBar quota={quotas?.get(instance.id)} />
                        </span>
                      </span>
                    </MenuItem>
                  )
                })}
              </MenuGroup>
            ))}
          </div>
          {(onAddAgent ?? onSettings) && (
            <>
              {options.length > 0 && <MenuSeparator />}
              {onAddAgent ? (
                <MenuItem icon={<Plus className="h-3.5 w-3.5" />} onClick={onAddAgent}>
                  Add new agent
                </MenuItem>
              ) : (
                <MenuItem icon={<Settings2 className="h-3.5 w-3.5" />} onClick={onSettings}>
                  Manage agents
                </MenuItem>
              )}
            </>
          )}
        </MenuContent>
      </Menu>
    </>
  )
}
