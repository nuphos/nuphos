import clsx from 'clsx'
import { useEffect, useRef } from 'react'

import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useThisComputer } from '../../hooks/useThisComputer'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'
import { t } from '../../i18n'

import { DeskShelf } from './BoxDeskShelf'
import { BOX_METRICS_POLL_MS, boxAgents, boxPollMs, vanishedBoxes } from './boxPresentation'
import { boxRestartEnded } from './boxRestartPresentation'
import { boxRestarts } from './boxRestartStore'
import { BoxRow } from './BoxRow'
import { PanelHeading } from './RuntimePanel'
import { useAdminName } from './useAdminName'
import { useAgentDevices } from './useAgentDevices'

import './BoxLoading.css'

import type { AgentDevice } from '../../api'
import type { RuntimeInstance } from '../../types/runtime'

// Metrics change every reading without changing the runtime catalog.
function deviceConfiguration({
  metrics: _metrics,
  metricsStatus: _status,
  metricsReceivedAt: _received,
  ...device
}: AgentDevice) {
  return device
}

/** The signed-in user's own Boxes, above the team's agents. Hidden when the backend has no Box provider. */
export function BoxSection({
  teamId,
  instances,
  onSelect,
  canCreate,
  onOpenSettingsSection,
}: {
  teamId: string
  /** Only the team's administrators add computers, from the page's Add computer; the backend enforces it. */
  canCreate: boolean
  instances: RuntimeInstance[]
  onSelect: (runtimeId: string) => void
  /** Opens a Settings section: here, Local runtime, where this computer's agent signs in. */
  onOpenSettingsSection?: (section: string) => void
}) {
  const thisComputer = useThisComputer()
  const previous = useRef<AgentDevice[]>([])
  const { isActive } = useWorkspaceTab()
  const {
    list,
    error: loadError,
    reload,
  } = useAgentDevices(
    // A restarting host comes back without the user acting.
    (next) => (boxRestarts.current().size ? BOX_METRICS_POLL_MS : boxPollMs(next.devices, false)),
    // A list is the team's: one taken before a team change never settles the new team's Boxes.
    teamId,
    {
      metrics: true,
      enabled: isActive,
      teamId,
    },
  )

  useEffect(() => {
    if (!list) return
    // The agents under each Box come from the runtime catalog: refresh it when the list changes.
    if (
      JSON.stringify(previous.current.map(deviceConfiguration)) !==
      JSON.stringify(list.devices.map(deviceConfiguration))
    )
      window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    for (const device of vanishedBoxes(previous.current, list.devices))
      toast.error(
        t('Computer setup failed'),
        t('{name} could not start and was removed.', { name: device.label }),
      )
    for (const { device, kind, outcome } of boxRestarts.settle(list.devices, teamId)) {
      const notice = device && boxRestartEnded(kind, outcome, device.label)

      if (notice?.tone === 'error') toast.error(notice.title, notice.description)
      else if (notice) toast.success(notice.title, notice.description)
    }
    previous.current = list.devices
  }, [list, teamId])

  // Everything ever registered stays listed; only its status follows presence.
  const owned = list?.devices ?? []
  // Members cannot create a Box: say who can, where the button would be.
  const admin = useAdminName(teamId, !canCreate && Boolean(list?.boxAvailable))
  const setUpLocalAgent =
    onOpenSettingsSection && (() => onOpenSettingsSection('device.localRuntime'))

  return (
    <section aria-label={t('Computers')} className="min-w-0">
      <PanelHeading
        title={t('Computers')}
        right={
          list?.boxAvailable &&
          !canCreate && (
            <span className="text-[11.5px] text-tertiary">
              {admin
                ? t('Ask {name} to add a cloud computer.', { name: admin })
                : t('Administrators add cloud computers.')}
            </span>
          )
        }
      />
      <div
        className={clsx('box-loading t-skel', list && 'is-revealed')}
        aria-busy={!list && !loadError}
      >
        {!list && loadError ? (
          <div
            role="status"
            className="flex h-[240px] items-center gap-3 text-[12px] text-tertiary"
          >
            {t('Could not load computers.')}
            <Button size="sm" variant="secondary" onClick={reload}>
              {t('Retry')}
            </Button>
          </div>
        ) : (
          <div className="t-skel-skeleton is-pulsing" aria-hidden="true">
            <div className="flex w-[300px] flex-col">
              <div className="mx-[10px] mb-[42px] mt-[44px] h-[184px] rounded-xl bg-state-selected" />
              <div className="h-px bg-state-selected" />
              <div className="mt-3 h-4 w-40 rounded bg-state-selected" />
              <div className="mt-2 h-3 w-52 rounded bg-state-selected" />
            </div>
          </div>
        )}
        <div className="t-skel-content">
          {owned.length > 0 && (
            <DeskShelf>
              {owned.map((device) => (
                <BoxRow
                  thisComputer={thisComputer?.deviceId === device.deviceId}
                  key={device.deviceId}
                  teamId={teamId}
                  device={device}
                  agents={boxAgents(device.deviceId, instances)}
                  onSelect={onSelect}
                  onSetUpLocalAgent={setUpLocalAgent}
                  onChanged={reload}
                />
              ))}
            </DeskShelf>
          )}
        </div>
      </div>
    </section>
  )
}
