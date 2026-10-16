import clsx from 'clsx'
import { Ellipsis, Play, Plus } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { AGENT_PROVIDER } from '../../types/runtime'

import { visibleAgent } from './agentPresentation'
import { BoxMetrics } from './BoxMetrics'
import { BoxAgentSignIn } from './BoxAgentSignIn'
import { openBoxDesktop } from './boxDesktop'
import { AgentTile, LiveDot, MachineIcon, MachineLine } from './BoxParts'
import {
  BOX_BADGE,
  boxActions,
  boxState,
  canManage,
  removal,
  newAgentAction,
} from './boxPresentation'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'
import { inputClasses } from './styles'

import type { AgentDevice } from '../../api'
import type { LocalAgentProvider } from '../../api/device-types'
import type { RuntimeInstance } from '../../types/runtime'

const PROVIDERS: LocalAgentProvider[] = ['claude-code', 'codex']

/** One machine in the Boxes list: its state, its agents and what can be done to it. */
export function BoxRow({
  thisComputer,
  teamId,
  device,
  agents,
  onSelect,
  onChanged,
}: {
  thisComputer: boolean
  teamId: string
  device: AgentDevice
  agents: RuntimeInstance[]
  onSelect: (runtimeId: string) => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  // An older host's existing agent, signing in.
  const [signingIn, setSigningIn] = useState<string | null>(null)
  const [adding, setAdding] = useState<LocalAgentProvider | null>(null)
  const signingInAgent = agents.find((agent) => agent.id === signingIn)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const state = boxState(device)
  const cloud = device.box !== undefined
  const manage = canManage(device)
  const remove = removal(device)
  const badge = BOX_BADGE[state]
  const actions = cloud ? boxActions(state) : { pause: false, resume: false }
  // Every Box action names the Box and the page's team.
  const act = (
    title: string,
    call: (deviceId: string, teamId: string) => Promise<unknown>,
    fallback?: string,
  ) => run(title, () => call(device.deviceId, teamId), fallback)
  const changed = () => {
    onChanged()
    window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
  }
  const run = async (title: string, action: () => Promise<unknown>, fallback?: string) => {
    setBusy(true)
    try {
      await action()
      changed()
    } catch (error) {
      toast.apiError(title, error, fallback === undefined ? undefined : { fallback })
    } finally {
      setBusy(false)
    }
  }

  // An older host cannot add agents; the backend still refuses with 409 if this is stale.
  const canAddAgents = agents.some((agent) => agent.local?.agentInstances === true)
  const addAgent = (provider: LocalAgentProvider) => {
    const action = newAgentAction(agents, provider)

    if (!action) return
    if ('signIn' in action) return setSigningIn(action.signIn)
    setAdding(provider)
  }

  const dim = state === 'paused' || state === 'stopped'
  const starting =
    state === 'creating' || state === 'connecting' || (state === 'running' && agents.length === 0)

  return (
    <li className="flex h-[220px] w-[248px] shrink-0 flex-col rounded-xl border border-zGray-800/70 p-3">
      <div className="flex shrink-0 items-center gap-2">
        <MachineIcon device={device} />
        {renaming === null ? (
          <span
            className="min-w-0 flex-1 truncate text-[13px] font-medium text-main"
            title={device.label}
          >
            {device.label}
          </span>
        ) : (
          <input
            autoFocus
            aria-label="Box name"
            value={renaming}
            maxLength={200}
            className={clsx(inputClasses, 'h-7 min-w-0 flex-1 text-[13px]')}
            onChange={(event) => setRenaming(event.target.value)}
            onBlur={() => setRenaming(null)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRenaming(null)
              if (event.key !== 'Enter') return
              const label = renaming.trim()

              setRenaming(null)
              // This computer keeps its name locally and re-registers with it, so rename it there.
              if (label && label !== device.label)
                void run('Could not rename Box', () =>
                  thisComputer
                    ? api.deviceSetLabel(label)
                    : api.boxRename(device.deviceId, teamId, label),
                )
            }}
          />
        )}
        <span
          role="status"
          className="flex shrink-0 items-center gap-1.5 text-[11px] text-tertiary"
        >
          {badge.tone === 'online' && <LiveDot />}
          {badge.label}
        </span>
        {manage && (
          <Menu>
            <MenuTrigger
              aria-label={`Manage ${device.label}`}
              disabled={busy}
              className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800/60 hover:text-main"
            >
              <Ellipsis className="h-4 w-4" />
            </MenuTrigger>
            <MenuContent align="end">
              {cloud && state === 'running' && (
                <MenuItem
                  onClick={() =>
                    void run('Could not open the desktop', () =>
                      openBoxDesktop(device.deviceId, teamId),
                    )
                  }
                >
                  Open desktop
                </MenuItem>
              )}
              <MenuItem onClick={() => setRenaming(device.label)}>Rename</MenuItem>
              {actions.resume && (
                <MenuItem onClick={() => void act('Could not resume Box', api.boxResume)}>
                  {state === 'error' ? 'Retry' : 'Resume'}
                </MenuItem>
              )}
              {actions.pause && (
                <MenuItem onClick={() => void act('Could not pause Box', api.boxPause)}>
                  Pause
                </MenuItem>
              )}
              {remove.allowed && (
                <>
                  <MenuSeparator />
                  <MenuItem destructive onClick={() => setConfirmDelete(true)}>
                    {remove.action}
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>
        )}
      </div>
      <MachineLine device={device} thisComputer={thisComputer} dim={dim} />
      {manage && (state === 'paused' || state === 'hostOffline') ? (
        <div className="mt-auto pb-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void act('Could not resume Box', api.boxResume)}
          >
            <Play className="h-3 w-3" />
            {busy ? 'Resuming…' : 'Resume'}
          </Button>
        </div>
      ) : (
        <BoxMetrics
          metrics={device.metrics}
          status={
            state === 'creating'
              ? 'starting'
              : state === 'connecting'
                ? 'connecting'
                : device.metricsStatus
          }
          receivedAt={device.metricsReceivedAt}
        />
      )}
      <ul
        className={clsx(
          state === 'paused' || state === 'hostOffline'
            ? 'hidden'
            : 'mt-auto flex shrink-0 items-center gap-2 overflow-x-auto pb-1',
          dim && 'opacity-50',
        )}
      >
        {starting
          ? [0, 1].map((slot) => (
              <li key={slot} className="h-10 w-10 shrink-0 rounded-lg bg-zGray-800/30" />
            ))
          : agents
              .filter(visibleAgent)
              .map((agent) => (
                <AgentTile key={agent.id} agent={agent} onSelect={() => onSelect(agent.id)} />
              ))}
        {manage && !dim && !starting && (
          <li className="shrink-0">
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
                    onClick={() => addAgent(provider)}
                  >
                    {canAddAgents
                      ? AGENT_PROVIDER[provider].label
                      : `Sign in to ${AGENT_PROVIDER[provider].label}`}
                  </MenuItem>
                ))}
                {!canAddAgents && (
                  <MenuItem disabled>Update the Box host to add more agents</MenuItem>
                )}
              </MenuContent>
            </Menu>
          </li>
        )}
      </ul>
      {adding && (
        <BoxAgentSignIn
          teamId={teamId}
          device={device}
          provider={adding}
          onDone={(runtimeId) => {
            setAdding(null)
            changed()
            if (runtimeId) onSelect(runtimeId)
          }}
        />
      )}
      {signingInAgent && (
        <RuntimeLoginDialog
          teamId={teamId}
          instance={signingInAgent}
          onClose={() => {
            setSigningIn(null)
            changed()
          }}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`${cloud ? 'Delete' : 'Remove'} ${device.label}?`}
        description={remove.description}
        destructive
        confirmLabel={remove.confirm}
        onConfirm={() =>
          act(remove.error, cloud ? api.boxDelete : api.deviceRemove, remove.fallback)
        }
        onClose={() => setConfirmDelete(false)}
      />
    </li>
  )
}
