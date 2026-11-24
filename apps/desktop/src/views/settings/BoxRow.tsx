import { Ellipsis, Loader2 } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { InlineRename } from '../../components/ui/inline-rename'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../../components/ui/menu'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useThisComputerConnection } from '../../hooks/useThisComputer'
import { t } from '../../i18n'

import { canManage, newAgentAction } from './agentPresentation'
import { BoxAccessDialog } from './BoxAccessDialog'
import { useComputerSettings } from './useComputerSettings'
import { BoxAgentSetup } from './BoxAgentSetup'
import { askToAdd, canAddAgent } from './boxAgentSlots'
import { DeskArt } from './BoxDesk'
import { DeskAgents, DeskReadings } from './BoxDeskInfo'
import { deskModel } from './boxDeskModel'
import { BoxHostUpdate } from './BoxHostUpdate'
import { AccessHint, LiveDot, MachineLine, OwnerLine, ResumeButton, ShareButton } from './BoxParts'
import { copyUid } from './boxCopyUid'
import { deleteBox } from './boxDelete'
import { pressureStatus } from './boxMetricsPresentation'
import { openBoxPaywall } from './boxPaywallStore'
import { BOX_BADGE, boxActions, boxState } from './boxPresentation'
import { boxRestartLabel, boxRestartOf } from './boxRestartPresentation'
import { boxRestarts, useBoxRestart } from './boxRestartStore'
import { openDesktop } from './computerDesktop'
import { ComputerNotices } from './ComputerNotices'
import { LocalAgentShareDialog } from './LocalAgentShareDialog'
import { removal } from './removalPresentation'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'
import { computerBadge } from './thisComputerPresentation'
import { useComputerOwner } from './useComputerOwner'
import { useComputerUpdate } from './useComputerUpdate'

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
  const AccessDialog = cloud ? BoxAccessDialog : LocalAgentShareDialog
  const manage = canManage(device)
  const owner = useComputerOwner(teamId, device)
  // Another of the viewer's own computers, a Box too, whose host opens its screen.
  const screen = thisComputer ? undefined : device.desktopRuntimeId
  const remove = removal(device)
  const badge = computerBadge(state, useThisComputerConnection(thisComputer))
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
  const computerSettings = useComputerSettings(device, teamId, changed)
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
  const metricsStatus = settingUp ? state : device.metricsStatus
  const away = !restart && (state === 'paused' || state === 'hostOffline')
  const pressure = away ? pressureStatus(device) : null
  const hostAgent = cloud && manage && state === 'running' && !restart ? agents[0]?.id : undefined
  const running = state === 'running' && !restart
  const hostUpdate = useComputerUpdate(teamId, device, { cloud, thisComputer, running, hostAgent })
  const updateVersion = hostUpdate.version
  const [confirmUpdate, setConfirmUpdate] = useState(false)
  const update = () =>
    act(t('Could not update computer'), async (deviceId, team) => {
      await hostUpdate.request(deviceId, team)
      boxRestarts.start(deviceId, team, 'update', device.lastSeenAt)
    })

  return (
    <li className="flex w-[300px] shrink-0 flex-col">
      <DeskArt model={deskModel(device)} on={!away && !dim}>
        <DeskReadings device={device} metricsStatus={restart ? 'connecting' : metricsStatus} />
        <DeskAgents
          device={device}
          agents={agents}
          starting={settingUp || restart !== undefined}
          away={away}
          dim={dim}
          busy={busy}
          onSelect={onSelect}
          onAdd={addAgent}
          canAdd={canAddAgent(state, manage)}
          ask={askToAdd(state, manage, owner)}
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
          <span className="shrink-0 rounded-full bg-state-selected px-1.5 text-[10.5px] leading-4 text-secondary">
            {t('This computer')}
          </span>
        )}
        <span className="flex-1" />
        {manage && <ShareButton disabled={busy} onClick={() => setSharing(true)} />}
        {manage && (
          <Menu>
            <MenuTrigger
              aria-label={t('Manage {name}', { name: device.label })}
              disabled={busy}
              className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-state-hover hover:text-main"
            >
              <Ellipsis className="h-4 w-4" />
            </MenuTrigger>
            <MenuContent align="end">
              {screen && (
                <MenuItem onClick={() => openDesktop(device.deviceId, teamId, screen, cloud)}>
                  {t('Open desktop')}
                </MenuItem>
              )}
              {hostUpdate.label && (
                <MenuItem
                  disabled={updateVersion === undefined}
                  onClick={() => setConfirmUpdate(true)}
                >
                  {hostUpdate.label}
                </MenuItem>
              )}
              {computerSettings.menuItem}
              <MenuItem onClick={() => setRenaming(true)}>{t('Rename')}</MenuItem>
              <MenuItem onClick={() => void copyUid(device)}>{t('Copy UID')}</MenuItem>
              <MenuItem onClick={() => setSharing(true)}>{t('Manage access…')}</MenuItem>
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
        <span
          role="status"
          title={pressure?.hint}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap"
        >
          {restart ? (
            <Loader2 aria-hidden className="h-3 w-3 animate-spin" />
          ) : (
            badge.tone === 'online' && <LiveDot />
          )}
          {restart ? boxRestartLabel(restart.kind) : (pressure?.label ?? badge.label)}
        </span>
        <MachineLine device={device} dim={dim} live={badge !== BOX_BADGE[state]} />
        <AccessHint device={device} />
        {updateVersion !== undefined && (
          <BoxHostUpdate
            confirm={hostUpdate.confirm(updateVersion, device.label)}
            version={updateVersion}
            busy={busy}
            confirming={confirmUpdate}
            onConfirmingChange={setConfirmUpdate}
            onUpdate={update}
          />
        )}
      </div>
      <OwnerLine device={device} owner={owner} />
      <ComputerNotices teamId={teamId} device={device} here={thisComputer} running={running} />
      {manage && away && <ResumeButton busy={busy} device={device} onClick={() => void resume()} />}
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
      {computerSettings.dialog}
      {sharing && (
        <AccessDialog
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
          act(remove.error, cloud ? deleteBox(device.label) : api.deviceRemove, remove.fallback)
        }
        onClose={() => setConfirmDelete(false)}
      />
    </li>
  )
}
