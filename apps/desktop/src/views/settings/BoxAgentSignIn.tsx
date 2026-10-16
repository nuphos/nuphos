import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { Modal } from '../../components/Modal'
import { toast } from '../../components/ui/toast'
import { AGENT_PROVIDER } from '../../types/runtime'

import { RuntimeLoginDialog } from './RuntimeLoginDialog'

import type { AgentDevice, DeviceAgentInstance, LocalAgentProvider } from '../../api/device-types'

/**
 * A new agent on a Box exists only once signed in: it is made pending, signed in at once,
 * and removed again unless the sign-in succeeds. `onDone` gets its runtime id when it does.
 */
export function BoxAgentSignIn({
  teamId,
  device,
  provider,
  onDone,
}: {
  teamId: string
  device: AgentDevice
  provider: LocalAgentProvider
  onDone: (runtimeId: string | null) => void
}) {
  const { label, account } = AGENT_PROVIDER[provider]
  const [created, setCreated] = useState<DeviceAgentInstance | null>(null)
  const [error, setError] = useState<string | null>(null)
  // One request across StrictMode's effect replay, and remembered if the user leaves first.
  const request = useRef<Promise<DeviceAgentInstance> | null>(null)
  const left = useRef(false)
  const { deviceId } = device

  useEffect(() => {
    const remove = (instanceId: string) =>
      void api
        .boxRemoveAgent(deviceId, teamId, instanceId)
        .catch((cause: unknown) => toast.apiError('Could not remove the unfinished agent', cause))

    request.current ??= api.boxCreateAgent(deviceId, teamId, provider)
    void request.current.then(
      (agent) => (left.current ? remove(agent.instanceId) : setCreated(agent)),
      (cause: unknown) => setError(parseAtlasError(cause).message),
    )
  }, [deviceId, teamId, provider])

  if (created)
    return (
      <RuntimeLoginDialog
        teamId={teamId}
        immediate
        instance={{
          id: created.runtimeId,
          provider,
          label: `${label} on ${device.label}`,
          status: 'active',
          kind: 'local',
          createdAt: '',
          local: {
            ownerUserId: '',
            deviceId,
            deviceLabel: device.label,
            instanceId: created.instanceId,
            signedIn: false,
          },
        }}
        onClose={(connected) => {
          if (!connected)
            void api
              .boxRemoveAgent(deviceId, teamId, created.instanceId)
              .catch((cause: unknown) =>
                toast.apiError('Could not remove the unfinished agent', cause),
              )
          onDone(connected ? created.runtimeId : null)
        }}
      />
    )

  const leave = () => {
    left.current = true
    onDone(null)
  }

  return (
    <Modal
      open
      onClose={leave}
      title={`Sign in with ${account}`}
      description={`${label} on ${device.label}`}
      closeOnBackdrop={false}
    >
      <div className="space-y-5 p-5" role="status" aria-live="polite">
        {error ? (
          <p role="alert" className="text-[13px] text-error">
            {error}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Starting {label}…
          </p>
        )}
        <button
          type="button"
          onClick={leave}
          className="rounded-md px-3 py-2 text-[13px] text-secondary hover:bg-zGray-800/60"
        >
          {error ? 'Close' : 'Cancel'}
        </button>
      </div>
    </Modal>
  )
}
