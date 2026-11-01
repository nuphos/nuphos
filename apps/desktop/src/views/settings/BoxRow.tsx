import { Ellipsis, Loader2, Play } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { Button } from '../../components/ui/button'
import { InlineRename } from '../../components/ui/inline-rename'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { t } from '../../i18n'

import { BoxAccessDialog } from './BoxAccessDialog'
import { BoxAgentSetup } from './BoxAgentSetup'
import { agentSlots, canAddAgent } from './boxAgentSlots'
import { DeskArt } from './BoxDesk'
import { DeskAgents, DeskReadings } from './BoxDeskInfo'
import { deskModel } from './boxDeskModel'
import { openBoxDesktop } from './boxDesktop'
import { BoxHostUpdate } from './BoxHostUpdate'
import { AccessHint, LiveDot, MachineLine } from './BoxParts'
import { copyUid } from './boxCopyUid'
import { openBoxPaywall } from './boxPaywallStore'
import {
  BOX_BADGE,
  boxActions,
  boxState,
  canManage,
  canShareBox,
  newAgentAction,
  removal,
} from './boxPresentation'
import { boxRestartLabel, boxRestartOf, boxUpdateLabel } from './boxRestartPresentation'
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
  onShare,
  onSetUpLocalAgent,
}: {
  thisComputer: boolean
  teamId: string
  device: AgentDevice
  agents: RuntimeInstance[]
  onSelect: (runtimeId: string) => void
  onChanged: () => void
  /** The person's own computer: share its local runtime with teammates. */
  onShare?: () => void
  /** Opens User settings where this computer's local agent signs in. */
  onSetUpLocalAgent?: () => void
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
    act(t('Could not resume computer'), async (deviceId, team) => {
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
  const slots = agentSlots(thisComputer, settingUp || restart !== undefined, state, agents)
  const metricsStatus = settingUp ? state : device.metricsStatus
  const away = !restart && (state === 'paused' || state === 'hostOffline')
  const hostAgent = cloud && manage && state === 'running' && !restart ? agents[0]?.id : undefined
  const updateVersion = useBoxHostUpdate(teamId, hostAgent)
  const [confirmUpdate, setConfirmUpdate] = useState(false)
  const update = () =>
    act(t('Could not update computer'), async (deviceId, team) => {
      if (!hostAgent) return
      await api.atlasRequestRuntimeUpdate(team, hostAgent)
      boxRestarts.start(deviceId, team, 'update')
    })

  const model = deskModel(device)

  return (
    <li className="flex w-[300px] shrink-0 flex-col">
      <DeskArt model={model} on={!away && !dim}>
        <DeskReadings device={device} metricsStatus={restart ? 'connecting' : metricsStatus} />
        <DeskAgents
          device={device}
          agents={agents}
          slots={slots}
          away={away}
          dim={dim}
          busy={busy}
          onSelect={onSelect}
          onAdd={addAgent}
          onSetUp={thisComputer ? onSetUpLocalAgent : undefined}
          canAdd={canAddAgent(state)}
        />
      </DeskArt>
      {/* A fixed height keeps the taller rename field from pushing the caption down. */}
      <div className="mt-2 flex h-6 shrink-0 items-center gap-2">
        <InlineRename
          value={device.label}
          canEdit={manage}
          editing={renaming}
          onEditingChange={setRenaming}
          ariaLabel={t('Computer name')}
          maxLength={200}
          errorTitle={t('Could not rename computer')}
          className="min-w-0 text-[13px] font-medium text-main"
          // This computer keeps its name locally and re-registers with it, so rename it there.
          onSave={async (label) => {
            await (thisComputer
              ? api.deviceSetLabel(label)
              : api.boxRename(device.deviceId, teamId, label))
            changed()
          }}
        />
        {thisComputer && (
          <span className="shrink-0 rounded-full bg-zGray-800/60 px-1.5 text-[10.5px] leading-4 text-secondary">
            {t('This computer')}
          </span>
        )}
        <span className="flex-1" />
        {manage && (
          <Menu>
            <MenuTrigger
              aria-label={t('Manage {name}', { name: device.label })}
              disabled={busy}
              className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800/60 hover:text-main"
            >
              <Ellipsis className="h-4 w-4" />
            </MenuTrigger>
            <MenuContent align="end">
              {cloud && state === 'running' && (
                <MenuItem onClick={() => openBoxDesktop(device.deviceId, teamId)}>
                  {t('Open desktop')}
                </MenuItem>
              )}
              {updateVersion !== undefined && (
                <MenuItem onClick={() => setConfirmUpdate(true)}>
                  {boxUpdateLabel(updateVersion)}
                </MenuItem>
              )}
              <MenuItem onClick={() => setRenaming(true)}>{t('Rename')}</MenuItem>
              <MenuItem onClick={() => void copyUid(device)}>{t('Copy UID')}</MenuItem>
              {canShareBox(device) && (
                <MenuItem onClick={() => setSharing(true)}>{t('Manage access…')}</MenuItem>
              )}
              {onShare && <MenuItem onClick={onShare}>{t('Share with teammates…')}</MenuItem>}
              {actions.resume && (
                <MenuItem onClick={() => void resume()}>
                  {state === 'error' ? t('Retry') : t('Resume')}
                </MenuItem>
              )}
              {actions.pause && (
                <MenuItem onClick={() => void act(t('Could not pause computer'), api.boxPause)}>
                  {t('Pause')}
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
      <div className="mt-0.5 flex min-w-0 shrink-0 items-center gap-1.5 text-[11.5px] leading-4 text-tertiary">
        <span role="status" className="flex items-center gap-1.5">
          {restart ? (
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
          ) : (
            badge.tone === 'online' && <LiveDot />
          )}
          {restart ? boxRestartLabel(restart.kind) : badge.label}
        </span>
        <MachineLine device={device} dim={dim} />
        <AccessHint device={device} />
        {updateVersion !== undefined && (
          <BoxHostUpdate
            boxLabel={device.label}
            version={updateVersion}
            busy={busy}
            confirming={confirmUpdate}
            onConfirmingChange={setConfirmUpdate}
            onUpdate={update}
          />
        )}
      </div>
      {manage && away && (
        <div className="mt-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void resume()}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {busy ? t('Resuming…') : t('Resume')}
          </Button>
        </div>
      )}
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
        title={remove.title}
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
