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
import { emptyNavigation, pageLocationForNavigation } from '../../lib/appRoutes'
import { AGENT_PROVIDER } from '../../types/runtime'

import { visibleAgent } from './agentPresentation'
import { BoxMetrics } from './BoxMetrics'
import { AgentTile, LiveDot, MachineIcon } from './BoxParts'
import { BOX_BADGE, boxActions, boxState, machineLine, newAgentAction } from './boxPresentation'
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
  // A runtime id: a just-created agent signs in once the catalog lists it.
  const [signingIn, setSigningIn] = useState<string | null>(null)
  const signingInAgent = agents.find((agent) => agent.id === signingIn)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const state = boxState(device)
  const cloud = device.box !== undefined
  const badge = BOX_BADGE[state]
  const actions = cloud ? boxActions(state) : { pause: false, resume: false, remove: false }
  // Every Box action names the Box and the page's team.
  const act = (title: string, call: (deviceId: string, teamId: string) => Promise<unknown>) =>
    run(title, () => call(device.deviceId, teamId))
  const run = async (title: string, action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      onChanged()
      window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    } catch (error) {
      toast.apiError(title, error)
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
    void run('Could not add agent', async () => {
      const { runtimeId } = await api.boxCreateAgent(device.deviceId, teamId, provider)

      // Details first; the sign-in opens over them once the catalog lists the new agent.
      onSelect(runtimeId)
      setSigningIn(runtimeId)
    })
  }

  const dim = state === 'paused' || state === 'stopped'
  const starting = state === 'creating' || (state === 'running' && agents.length === 0)

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
                  void run('Could not open the desktop', async () => {
                    const { url } = await api.boxDesktop(device.deviceId, teamId)
                    const href = pageLocationForNavigation(
                      emptyNavigation({ kind: 'team', teamId }, 'team.desktop', {
                        browserUrl: url,
                      }),
                    ).href

                    window.dispatchEvent(new CustomEvent('nuphos:open-in-app', { detail: href }))
                  })
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
            {actions.remove && (
              <>
                <MenuSeparator />
                <MenuItem destructive onClick={() => setConfirmDelete(true)}>
                  Delete
                </MenuItem>
              </>
            )}
          </MenuContent>
        </Menu>
      </div>
      <div
        title={machineLine(device)}
        className={clsx(
          'mt-1 shrink-0 truncate text-[11.5px] leading-4 text-tertiary',
          dim && 'opacity-50',
        )}
      >
        {thisComputer ? 'This computer' : machineLine(device)}
      </div>
      {state === 'paused' ? (
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
          status={device.metricsStatus}
          receivedAt={device.metricsReceivedAt}
        />
      )}
      <ul
        className={clsx(
          state === 'paused'
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
        {!dim && !starting && (
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
                {agents
                  .filter((agent) => agent.local?.instanceId && agent.local.signedIn !== true)
                  .map((agent) => (
                    <MenuItem
                      key={agent.id}
                      disabled={busy}
                      onClick={() => {
                        onSelect(agent.id)
                        setSigningIn(agent.id)
                      }}
                    >
                      Continue signing in to {agent.label} ({agent.local?.instanceId?.slice(0, 8)})
                    </MenuItem>
                  ))}
              </MenuContent>
            </Menu>
          </li>
        )}
      </ul>
      {signingInAgent && (
        <RuntimeLoginDialog
          teamId={teamId}
          instance={signingInAgent}
          onClose={() => {
            setSigningIn(null)
            onChanged()
            window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
          }}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${device.label}?`}
        description="This permanently deletes the Box, its files and its agents' sign-ins, and stops conversations running on it. Your conversation history stays in Nuphos."
        destructive
        confirmLabel="Delete Box"
        onConfirm={() => act('Could not delete Box', api.boxDelete)}
        onClose={() => setConfirmDelete(false)}
      />
    </li>
  )
}
