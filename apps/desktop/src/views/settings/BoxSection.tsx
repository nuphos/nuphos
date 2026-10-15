import clsx from 'clsx'
import { Box, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useThisComputer } from '../../hooks/useThisComputer'
import { useWorkspaceTab } from '../../hooks/useWorkspaceTab'

import { JoinDialog } from './BoxParts'
import { boxAgents, boxPollMs, machines, vanishedBoxes } from './boxPresentation'
import { BoxRow } from './BoxRow'
import { PanelHeading } from './RuntimePanel'
import { useAgentDevices } from './useAgentDevices'

import './BoxLoading.css'

import type { BoxJoin } from './BoxParts'
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
  const [join, setJoin] = useState<BoxJoin | null>(null)
  const previous = useRef<AgentDevice[]>([])
  const { isActive } = useWorkspaceTab()
  const {
    list,
    error: loadError,
    reload,
  } = useAgentDevices((next) => boxPollMs(next.devices, false) || 5_000, '', {
    metrics: true,
    enabled: isActive,
    teamId,
  })

  useEffect(() => {
    if (!list) return
    // The agents under each Box come from the runtime catalog: refresh it when the list changes.
    if (
      JSON.stringify(previous.current.map(deviceConfiguration)) !==
      JSON.stringify(list.devices.map(deviceConfiguration))
    )
      window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    for (const device of vanishedBoxes(previous.current, list.devices))
      toast.error('Box setup failed', `${device.label} could not start and was removed.`)
    previous.current = list.devices
  }, [list])

  const create = async () => {
    setCreating(true)
    try {
      await api.boxCreate(undefined, teamId)
      reload()
    } catch (error) {
      toast.apiError('Could not create Box', error)
    } finally {
      setCreating(false)
    }
  }
  const owned = machines(list?.devices ?? [])

  return (
    <section aria-label="Boxes" className="min-w-0">
      <PanelHeading
        title="Boxes"
        right={
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void create()
            }}
          >
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!list}
              onClick={() =>
                void api
                  .boxJoinToken()
                  .then(setJoin, (error: unknown) =>
                    toast.apiError('Could not make a join command', error),
                  )
              }
            >
              Connect external Box
            </Button>
            {list?.boxAvailable && canCreate && (
              <Button type="submit" size="sm" variant="secondary" disabled={creating || !list}>
                {creating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Box className="h-3.5 w-3.5" />
                )}
                New Box
              </Button>
            )}
          </form>
        }
      />
      {join && <JoinDialog join={join} onClose={() => setJoin(null)} />}
      <div
        className={clsx('box-loading t-skel', list && 'is-revealed')}
        aria-busy={!list && !loadError}
      >
        {!list && loadError ? (
          <div
            role="status"
            className="flex h-[220px] items-center gap-3 text-[12px] text-tertiary"
          >
            Could not load Boxes.
            <Button size="sm" variant="secondary" onClick={reload}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="t-skel-skeleton is-pulsing" aria-hidden="true">
            <div className="flex h-[220px] w-[248px] flex-col gap-3 rounded-xl border border-zGray-800/70 p-3">
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
                  onChanged={reload}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
