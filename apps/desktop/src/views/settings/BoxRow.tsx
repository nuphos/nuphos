import clsx from 'clsx'
import { Ellipsis, Play } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { InlineRename } from '../../components/ui/inline-rename'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'

import { visibleAgent } from './agentPresentation'
import { BoxMetrics } from './BoxMetrics'
import { BoxAgentSignIn } from './BoxAgentSignIn'
import { openBoxDesktop } from './boxDesktop'
import { BoxAccessDialog } from './BoxAccessDialog'
import { AccessHint, AgentTile, LiveDot, MachineIcon, MachineLine, NewAgentMenu } from './BoxParts'
import {
  BOX_BADGE,
  boxActions,
  boxState,
  canManage,
  canShareBox,
  removal,
  newAgentAction,
} from './boxPresentation'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'

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

  const addAgent = (provider: LocalAgentProvider) => {
    const action = newAgentAction(agents, provider)

    if (!action) return
    if ('signIn' in action) return setSigningIn(action.signIn)
    setAdding(provider)
  }

  const dim = state === 'paused' || state === 'stopped'
  const settingUp = state === 'creating' || state === 'connecting'
  const starting = settingUp || (state === 'running' && agents.length === 0)

  return (
    <li className="flex h-[220px] w-[248px] shrink-0 flex-col rounded-xl border border-zGray-800/70 p-3">
      <div className="flex shrink-0 items-center gap-2">
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
        <AccessHint device={device} />
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
                <MenuItem onClick={() => openBoxDesktop(device.deviceId, teamId)}>
                  Open desktop
                </MenuItem>
              )}
              <MenuItem onClick={() => setRenaming(true)}>Rename</MenuItem>
              {canShareBox(device) && (
                <MenuItem onClick={() => setSharing(true)}>Manage access…</MenuItem>
              )}
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
          status={settingUp ? state : device.metricsStatus}
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
            <NewAgentMenu device={device} agents={agents} busy={busy} onAdd={addAgent} />
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
