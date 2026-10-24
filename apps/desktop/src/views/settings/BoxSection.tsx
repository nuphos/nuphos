import clsx from 'clsx'
import { Box } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useThisComputer } from '../../hooks/useThisComputer'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'

import { BOX_METRICS_POLL_MS, boxAgents, boxPollMs, vanishedBoxes } from './boxPresentation'
import { boxRestartEnded } from './boxRestartPresentation'
import { boxRestarts } from './boxRestartStore'
import { BoxRow } from './BoxRow'
import { LocalAgentSharingCard } from './LocalAgentSharingCard'
import { NewBoxDialog } from './NewBoxDialog'
import { PanelHeading } from './RuntimePanel'
import { useAgentDevices } from './useAgentDevices'
import { useBoxUsage } from './useBoxUsage'

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
}: {
  teamId: string
  /** Only the team's administrators make Boxes; the backend enforces it. */
  canCreate: boolean
  instances: RuntimeInstance[]
  onSelect: (runtimeId: string) => void
}) {
  const thisComputer = useThisComputer()
  const [creating, setCreating] = useState(false)
  const [sharing, setSharing] = useState(false)
  const previous = useRef<AgentDevice[]>([])
  const { usage, reload: reloadUsage } = useBoxUsage(teamId)
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
      toast.error('Computer setup failed', `${device.label} could not start and was removed.`)
    for (const { device, kind, outcome } of boxRestarts.settle(list.devices, teamId)) {
      const notice = device && boxRestartEnded(kind, outcome, device.label)

      if (notice?.tone === 'error') toast.error(notice.title, notice.description)
      else if (notice) toast.success(notice.title, notice.description)
    }
    previous.current = list.devices
  }, [list, teamId])

  // Everything ever registered stays listed; only its status follows presence.
  const owned = list?.devices ?? []
  // Sharing is for the person's own computer, never a Box: its card sits under the computers.
  const ownComputer = owned.find(
    (device) => device.box === undefined && device.deviceId === thisComputer?.deviceId,
  )

  return (
    <section aria-label="Computers" className="min-w-0">
      <PanelHeading
        title="Computers"
        right={
          list?.boxAvailable &&
          canCreate && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                reloadUsage()
                setCreating(true)
              }}
            >
              <Box className="h-3.5 w-3.5" />
              New computer
            </Button>
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
            Could not load computers.
            <Button size="sm" variant="secondary" onClick={reload}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="t-skel-skeleton is-pulsing" aria-hidden="true">
            <div className="flex h-[240px] w-[248px] flex-col gap-3 rounded-xl border border-zGray-800/70 p-3">
              <div className="h-5 w-32 rounded bg-zGray-800/40" />
              <div className="h-3 w-44 rounded bg-zGray-800/30" />
              <div className="h-10 rounded bg-zGray-800/30" />
              <div className="mt-auto flex gap-2">
                <div className="h-10 w-10 rounded-lg bg-zGray-800/40" />
                <div className="h-10 w-10 rounded-lg bg-zGray-800/40" />
              </div>
            </div>
          </div>
        )}
        <div className="t-skel-content">
          {owned.length > 0 && (
            <ul className="flex gap-3 overflow-x-auto pb-2">
              {owned.map((device) => (
                <BoxRow
                  thisComputer={thisComputer?.deviceId === device.deviceId}
                  key={device.deviceId}
                  teamId={teamId}
                  device={device}
                  agents={boxAgents(device.deviceId, instances)}
                  onSelect={onSelect}
                  {...(device === ownComputer ? { onShare: () => setSharing(true) } : {})}
                  onChanged={() => {
                    reload()
                    reloadUsage()
                  }}
                />
              ))}
            </ul>
          )}
          {ownComputer && thisComputer && (
            <div className="mt-3">
              <LocalAgentSharingCard
                teamId={teamId}
                currentUserId={thisComputer.userId}
                device={ownComputer}
                editing={sharing}
                onEditingChange={setSharing}
              />
            </div>
          )}
        </div>
      </div>
      {creating && (
        <NewBoxDialog
          teamId={teamId}
          usage={usage}
          labels={owned.map((device) => device.label)}
          onClose={() => setCreating(false)}
          onCreated={() => {
            reload()
            reloadUsage()
          }}
          onPlanChanged={reloadUsage}
        />
      )}
    </section>
  )
}
