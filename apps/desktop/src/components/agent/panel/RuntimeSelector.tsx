import clsx from 'clsx'
import { ChevronDown, Plus, Settings2 } from 'lucide-react'
import { useState } from 'react'

import { useAgentUpdates } from '../../../hooks/useAgentUpdates'
import { useThisComputer } from '../../../hooks/useThisComputer'
import { agentName } from '../../../lib/agentName'
import { AGENT_PROVIDER } from '../../../types/runtime'
import { useAgentDevices } from '../../../views/settings/useAgentDevices'
import { ConfirmDialog } from '../../ConfirmDialog'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../ui/menu'

import { AgentProviderIcon } from './icons'
import { selectedAgentReachability } from './runtimeControlSignOut'
import { selectorBoxes } from './selectorBoxes'
import { SelectorBoxMenu } from './SelectorBoxMenu'

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
  ready: { color: 'bg-success', label: 'Computer online · runtime ready' },
  signIn: { color: 'bg-warning', label: 'Computer online · runtime needs sign-in' },
  offline: { color: 'bg-error', label: 'Computer offline' },
} as const

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
  hero = false,
}: RuntimeControl & {
  /** Lets the composer open the list, e.g. from the agent-status banner. */
  menuOpen?: boolean
  onMenuOpenChange?: (open: boolean) => void
  /** Sized like the hero composer's other controls; compact otherwise. */
  hero?: boolean
}) {
  const providerName = AGENT_PROVIDER[value?.provider ?? 'claude-code'].label
  const owner = useThisComputer()
  const selected = value?.id ? options.find((instance) => instance.id === value.id) : undefined
  const [internalOpen, setInternalOpen] = useState(false)
  const open = menuOpen ?? internalOpen
  const setOpen = (next: boolean) => {
    setInternalOpen(next)
    onMenuOpenChange?.(next)
  }
  const devices = useAgentDevices(() => 5_000, teamId, {
    metrics: true,
    enabled: open && Boolean(teamId),
    teamId,
  })
  const groups = selectorBoxes(options, devices.list?.devices, quotas)
  const label = value
    ? agentName(selected ?? { ...(value.id ? { id: value.id } : {}), label: value.label }, owner)
    : loading
      ? 'Loading runtimes…'
      : 'Choose runtime'
  const updates = useAgentUpdates(teamId, options, canUpdateTeamAgents)
  const reachability = selectedAgentReachability({ value, options })
  const dot = reachability ? AGENT_DOT[reachability] : null
  const content = (
    <>
      <AgentProviderIcon provider={value?.provider} className="h-3.5 w-3.5 shrink-0" />
      {loading && !value ? (
        <span
          aria-label="Loading runtime"
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
  const classes = clsx(
    hero ? 'h-8 px-2.5' : 'h-7 px-2',
    'hidden min-w-0 max-w-fit grow basis-16 items-center gap-1.5 overflow-hidden rounded-full text-[12px] text-secondary @[230px]:flex',
  )

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
      <Menu open={open} onOpenChange={setOpen}>
        <MenuTrigger
          aria-label={`Conversation runtime: ${label}`}
          className={`${classes} transition-colors hover:bg-zGray-800/60 hover:text-main`}
        >
          {content}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </MenuTrigger>
        <MenuContent side="top" align="end" className="w-72">
          {error && <p className="px-2 py-2 text-xs text-error">{error}</p>}
          {!loading && !error && groups.length === 0 && (
            <p className="px-2 py-2 text-xs text-tertiary">
              Connect a runtime in Settings → Agent to get started.
            </p>
          )}
          <div className="max-h-96 overflow-auto">
            {groups.map((group) => (
              <SelectorBoxMenu
                key={group.id}
                group={group}
                selectedId={value?.id}
                metricsUnavailable={devices.error}
                quotas={quotas}
                updates={updates}
                selectDisabled={selectDisabled}
                onSelect={onSelect}
              />
            ))}
          </div>
          {(onAddAgent ?? onSettings) && (
            <>
              {groups.length > 0 && <MenuSeparator />}
              {onAddAgent ? (
                <MenuItem icon={<Plus className="h-3.5 w-3.5" />} onClick={onAddAgent}>
                  Add new runtime
                </MenuItem>
              ) : (
                <MenuItem icon={<Settings2 className="h-3.5 w-3.5" />} onClick={onSettings}>
                  Manage computers and runtimes
                </MenuItem>
              )}
            </>
          )}
        </MenuContent>
      </Menu>
    </>
  )
}
