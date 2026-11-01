import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { AGENT_PROVIDER } from '../../types/runtime'

import { agentNameTaken, defaultAgentName } from './boxPresentation'
import { RuntimeLoginBody } from './RuntimeLoginBody'
import { RuntimeLoginActions } from './RuntimeLoginDialog'
import { Field } from './shared'
import { inputClasses } from './styles'
import { useRuntimeLogin } from './useRuntimeLogin'

import type { AgentDevice, DeviceAgentInstance, LocalAgentProvider } from '../../api/device-types'
import type { RuntimeInstance } from '../../types/runtime'

const FORM = 'box-agent-setup-form'

/** The agent just made, as the sign-in knows an agent; the catalog lists it once signed in. */
function pendingInstance(agent: DeviceAgentInstance, device: AgentDevice): RuntimeInstance {
  return {
    id: agent.runtimeId,
    provider: agent.provider,
    label: t('{agent} on {computer}', { agent: agent.label, computer: device.label }),
    status: 'active',
    kind: 'local',
    createdAt: '',
    local: {
      ownerUserId: '',
      deviceId: device.deviceId,
      deviceLabel: device.label,
      instanceId: agent.instanceId,
      signedIn: false,
    },
  }
}

/**
 * A new agent on a Box, in one dialog: its settings, then its sign-in. It exists only once
 * signed in: made pending when the settings are confirmed, and removed again unless the
 * sign-in succeeds. `onDone` gets its runtime id when it does.
 */
export function BoxAgentSetup({
  teamId,
  device,
  provider,
  agents,
  onDone,
}: {
  teamId: string
  device: AgentDevice
  provider: LocalAgentProvider
  agents: RuntimeInstance[]
  onDone: (runtimeId: string | null) => void
}) {
  const { label, account } = AGENT_PROVIDER[provider]
  const [name, setName] = useState(() => defaultAgentName(agents, provider))
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<DeviceAgentInstance | null>(null)
  const left = useRef(false)
  const body = useRef<HTMLDivElement>(null)
  const instance = useMemo(() => created && pendingInstance(created, device), [created, device])
  // Idle until the agent exists; then it starts at once, the backend waiting for the agent.
  const login = useRuntimeLogin(
    teamId,
    instance,
    () => {
      if (!created || !instance) return
      toast.success(
        t('{account} connected', { account }),
        t('{name} is now signed in.', { name: instance.label }),
      )
      onDone(created.runtimeId)
    },
    true,
  )
  const { deviceId } = device
  const taken = agentNameTaken(agents, name)
  const remove = (instanceId: string) =>
    void api
      .boxRemoveAgent(deviceId, teamId, instanceId)
      .catch((cause: unknown) =>
        toast.apiError(t('Could not remove the unfinished runtime'), cause),
      )

  const create = async () => {
    const chosen = name.trim()

    setCreating(true)
    try {
      // The provider's own name is the default the agent has without one.
      const agent = await api.boxCreateAgent(
        deviceId,
        teamId,
        provider,
        chosen === label ? undefined : chosen,
      )

      if (left.current) remove(agent.instanceId)
      else setCreated(agent)
    } catch (cause) {
      if (!left.current) toast.apiError(t('Could not add {name}', { name: label }), cause)
    } finally {
      setCreating(false)
    }
  }

  const leave = async () => {
    if (created) {
      if (!(await login.cancel())) return
      remove(created.instanceId)
    }
    left.current = true
    onDone(null)
  }

  // Continue unmounts with step 1, so focus moves into the sign-in.
  useEffect(() => {
    if (created) body.current?.focus()
  }, [created])

  return (
    <Modal
      open
      onClose={() => void leave()}
      title={
        created
          ? t('Sign in with {account}', { account })
          : t('New {name} runtime', { name: label })
      }
      description={
        created
          ? t('Step 2 of 2 · Sign in · {computer}', { computer: device.label })
          : t('Step 1 of 2 · Settings · {computer}', { computer: device.label })
      }
      closeOnBackdrop={false}
      footer={
        created ? (
          <RuntimeLoginActions state={login} onClose={() => void leave()} />
        ) : (
          <div className="flex justify-end gap-2 px-5 py-3">
            <Button size="sm" variant="secondary" onClick={() => void leave()}>
              {t('Cancel')}
            </Button>
            <Button size="sm" type="submit" form={FORM} disabled={creating || !name.trim()}>
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {creating ? t('Starting {name}…', { name: label }) : t('Continue')}
            </Button>
          </div>
        )
      }
    >
      {instance ? (
        <div
          ref={body}
          tabIndex={-1}
          className="space-y-5 p-5 outline-none"
          role="status"
          aria-live="polite"
        >
          <RuntimeLoginBody instance={instance} state={login} />
        </div>
      ) : (
        <form
          id={FORM}
          className="space-y-4 p-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim() && !creating) void create()
          }}
        >
          <div className="flex items-center gap-2 text-[13px] text-main">
            <AgentProviderIcon provider={provider} className="h-4 w-4" />
            {label}
          </div>
          <Field
            label={t('Name')}
            hint={
              taken
                ? t('Another runtime on this computer already has this name.')
                : t(
                    'How this runtime appears on the computer and when choosing a runtime for an agent.',
                  )
            }
          >
            <input
              aria-label={t('Runtime name')}
              className={inputClasses}
              value={name}
              maxLength={100}
              required
              autoFocus
              spellCheck={false}
              autoComplete="off"
              disabled={creating}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </form>
      )}
    </Modal>
  )
}
