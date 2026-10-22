import clsx from 'clsx'
import { Ellipsis, Loader2, Play } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { InlineRename } from '../../components/ui/inline-rename'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'

import { BoxAccessDialog } from './BoxAccessDialog'
import { BoxAgentSetup } from './BoxAgentSetup'
import { openBoxDesktop } from './boxDesktop'
import { BoxHostUpdate } from './BoxHostUpdate'
import { BoxMetrics } from './BoxMetrics'
import { AccessHint, AgentTile, LiveDot, MachineIcon, MachineLine, NewAgentMenu } from './BoxParts'
import { openBoxPaywall } from './boxPaywallStore'
import {
  BOX_BADGE,
  boxActions,
  boxState,
  canManage,
  canShareBox,
  removal,
  newAgentAction,
} from './boxPresentation'
import { boxRestartLabel, boxRestartOf } from './boxRestartPresentation'
import { boxRestarts, useBoxRestart } from './boxRestartStore'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'
import { useBoxHostUpdate } from './useBoxHostUpdate'

import type { AgentDevice } from '../../api'
import type { LocalAgentProvider } from '../../api/device-types'
import type { RuntimeInstance } from '../../types/runtime'

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
  const [renaming, setRenaming] = useState(false)
  const [sharing, setSharing] = useState(false)
  const state = boxState(device)
  // A host restarting at the user's request is away on purpose: follow it, not offer Resume.
  const restart = boxRestartOf(useBoxRestart(device.deviceId), device)
  const cloud = device.box !== undefined
  const manage = canManage(device)
  const remove = removal(device)
  const badge = BOX_BADGE[state]
  const actions = cloud && !restart ? boxActions(state) : { pause: false, resume: false }
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
      // A Resume the plan has no room for: the paywall offers one, then resumes.
      if (!openBoxPaywall(teamId, error, () => void run(title, action, fallback)))
        toast.apiError(title, error, fallback === undefined ? undefined : { fallback })
    } finally {
      setBusy(false)
    }
  }

  // The host takes a while to join after the machine starts; the card follows it until then.
  const resume = () =>
    act('Could not resume Box', async (deviceId, team) => {
      await api.boxResume(deviceId, team)
      boxRestarts.start(deviceId, team, 'resume')
    })

  const addAgent = (provider: LocalAgentProvider) => {
    const action = newAgentAction(agents, provider)

    if (!action) return
    if ('signIn' in action) return setSigningIn(action.signIn)
    setAdding(provider)
  }

  const dim = state === 'paused' || state === 'stopped'
  const settingUp = state === 'creating' || state === 'connecting'
  const starting =
    settingUp || restart !== undefined || (state === 'running' && agents.length === 0)
  const metricsStatus = settingUp ? state : device.metricsStatus
  const away = !restart && (state === 'paused' || state === 'hostOffline')
  const hostAgent = cloud && manage && state === 'running' && !restart ? agents[0]?.id : undefined
  const updateVersion = useBoxHostUpdate(teamId, hostAgent)
  const [confirmUpdate, setConfirmUpdate] = useState(false)
  const update = () =>
    act('Could not update Box', async (deviceId, team) => {
      if (!hostAgent) return
      await api.atlasRequestRuntimeUpdate(team, hostAgent)
      boxRestarts.start(deviceId, team, 'update')
    })

  return (
    <li className="flex h-[240px] w-[248px] shrink-0 flex-col rounded-xl border border-zGray-800/70 p-3">
      {/* The name has the header to itself, so it and its rename field use the card's width.
          A fixed height keeps the taller rename field from pushing the card's contents down. */}
      <div className="flex h-6 shrink-0 items-center gap-2">
        <MachineIcon device={device} />
        <InlineRename
          value={device.label}
          canEdit={manage}
          editing={renaming}
          onEditingChange={setRenaming}
          ariaLabel={cloud ? 'Box name' : 'Computer name'}
          maxLength={200}
          errorTitle={`Could not rename ${cloud ? 'Box' : 'computer'}`}
          className="flex-1 text-[13px] font-medium text-main"
          // This computer keeps its name locally and re-registers with it, so rename it there.
          onSave={async (label) => {
            await (thisComputer
              ? api.deviceSetLabel(label)
              : api.boxRename(device.deviceId, teamId, label))
            changed()
          }}
        />
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
                <MenuItem onClick={() => openBoxDesktop(device.deviceId, teamId)}>
                  Open desktop
                </MenuItem>
              )}
              {updateVersion !== undefined && (
                <MenuItem onClick={() => setConfirmUpdate(true)}>
                  {updateVersion ? `Update to v${updateVersion}` : 'Update'}
                </MenuItem>
              )}
              <MenuItem onClick={() => setRenaming(true)}>Rename</MenuItem>
              {canShareBox(device) && (
                <MenuItem onClick={() => setSharing(true)}>Manage access…</MenuItem>
              )}
              {actions.resume && (
                <MenuItem onClick={() => void resume()}>
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
      <div className="mt-1 flex shrink-0 items-center gap-1.5 text-[11px] leading-4 text-tertiary">
        <span role="status" className="flex items-center gap-1.5">
          {restart ? (
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
          ) : (
            badge.tone === 'online' && <LiveDot />
          )}
          {restart ? boxRestartLabel(restart.kind) : badge.label}
        </span>
        <AccessHint device={device} />
        {updateVersion !== undefined && (
          <BoxHostUpdate
            boxLabel={device.label}
            version={updateVersion}
            busy={busy}
            confirming={confirmUpdate}
            onConfirmingChange={setConfirmUpdate}
            onUpdate={() => void update()}
          />
        )}
      </div>
      <MachineLine device={device} thisComputer={thisComputer} dim={dim} />
      {manage && away ? (
        <div className="mt-auto pb-1">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void resume()}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {busy ? 'Resuming…' : 'Resume'}
          </Button>
        </div>
      ) : (
        <BoxMetrics
          metrics={device.metrics}
          status={restart ? 'connecting' : metricsStatus}
          receivedAt={device.metricsReceivedAt}
        />
      )}
      <ul
        className={clsx(
          away ? 'hidden' : 'mt-auto flex shrink-0 items-center gap-2 overflow-x-auto pb-1',
          dim && 'opacity-50',
        )}
      >
        {starting
          ? [0, 1].map((slot) => (
              <li key={slot} className="h-10 w-10 shrink-0 rounded-lg bg-zGray-800/30" />
            ))
          : agents.map((agent) => (
              <AgentTile key={agent.id} agent={agent} onSelect={() => onSelect(agent.id)} />
            ))}
        {!dim && !starting && (
          <li className="shrink-0">
            <NewAgentMenu device={device} agents={agents} busy={busy} onAdd={addAgent} />
          </li>
        )}
      </ul>
      {adding && (
        <BoxAgentSetup
          teamId={teamId}
          device={device}
          provider={adding}
          agents={agents}
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
      {sharing && (
        <BoxAccessDialog
          teamId={teamId}
          device={device}
          onClose={() => setSharing(false)}
          onSaved={changed}
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
