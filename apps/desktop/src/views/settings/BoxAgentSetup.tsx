import { Check, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useThisComputer } from '../../hooks/useThisComputer'
import { t } from '../../i18n'
import { isThisComputer } from '../../lib/agentName'
import { agentProvider } from '../../types/runtime'

import { agentNameTaken, defaultAgentName } from './boxPresentation'
import { draftIncomplete, draftValue, providerDraft } from './customProviderDraft'
import { CustomProviderFields } from './CustomProviderFields'
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
    label: t('{runtime} on {computer}', { runtime: agent.label, computer: device.label }),
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

/** Where the dialog is: choosing the agent, then installing and signing in. */
function Stepper({ step }: { step: number }) {
  return (
    <ol className="grid grid-cols-2 gap-1.5 px-5 text-xs">
      {[t('Choose'), t('Install & sign in')].map((name, index) => (
        <li
          key={name}
          aria-current={index === step ? 'step' : undefined}
          className={index === step ? 'font-medium text-main' : 'text-tertiary'}
        >
          <span
            className={`mb-1.5 block h-0.5 rounded-full ${index <= step ? 'bg-[rgb(var(--color-text-base))]' : 'bg-state-selected'}`}
          />
          {name}
        </li>
      ))}
    </ol>
  )
}

/**
 * A new agent on a Box, in one dialog: its settings, then its sign-in. It exists only once
 * signed in: made pending when the settings are confirmed, and removed again unless the
 * sign-in succeeds. `onDone` gets its runtime id when it does. An OpenCode on this computer may
 * take a provider of its own instead, which saved there stands in for the sign-in.
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
  const { label, account } = agentProvider(provider)
  const [name, setName] = useState(() => defaultAgentName(agents, provider))
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<DeviceAgentInstance | null>(null)
  const [ready, setReady] = useState(false)
  const [draft, setDraft] = useState(() => providerDraft(undefined, 'none'))
  const [providerError, setProviderError] = useState<string | null>(null)
  const left = useRef(false)
  const body = useRef<HTMLDivElement>(null)
  const instance = useMemo(() => created && pendingInstance(created, device), [created, device])
  const here = useThisComputer()
  const ownProvider =
    provider === 'opencode' &&
    isThisComputer(here, { userId: device.ownerUserId, deviceId: device.deviceId })
  const custom = ownProvider && draft.kind !== 'none'
  // Idle until the agent exists; then it starts at once, the backend waiting for the agent.
  // Never with a provider of its own: ready already, it has no sign-in to start.
  const login = useRuntimeLogin(
    teamId,
    ready ? null : instance,
    // Ready rather than signed in: OpenCode's free models finish here with no sign-in, and
    // an API key is not checked until a turn runs.
    () => setReady(true),
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
      else if (custom) await saveProvider(agent)
      else setCreated(agent)
    } catch (cause) {
      if (!left.current) toast.apiError(t('Could not add {name}', { name: label }), cause)
    } finally {
      setCreating(false)
    }
  }

  /** Saving the provider keeps the agent; a refusal removes it again, with the form left as typed. */
  const saveProvider = async (agent: DeviceAgentInstance) => {
    setProviderError(null)
    try {
      await api.localRuntimeSetCustomProvider('opencode', draftValue(draft), agent.instanceId)
    } catch (cause) {
      remove(agent.instanceId)
      setProviderError(parseAtlasError(cause).message)

      return
    }
    if (left.current) return remove(agent.instanceId)
    window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    setCreated(agent)
    setReady(true)
  }

  const leave = async () => {
    if (created && ready) {
      onDone(created.runtimeId)

      return
    }
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
        ready
          ? t('{name} runtime added', { name: label })
          : created
            ? t('Sign in with {account}', { account })
            : t('New {name} runtime', { name: label })
      }
      description={t('{name} · {computer}', { name: label, computer: device.label })}
      headerLeading={
        <span className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line-control">
          <AgentProviderIcon provider={provider} className="h-5 w-5" />
        </span>
      }
      headerDivider={ready}
      closeOnBackdrop={false}
      footer={
        ready ? (
          <div className="flex justify-end px-5 py-3">
            <Button size="sm" onClick={() => void leave()}>
              {t('Done')}
            </Button>
          </div>
        ) : created ? (
          <RuntimeLoginActions state={login} onClose={() => void leave()} />
        ) : (
          <div className="flex justify-end gap-2 px-5 py-3">
            <Button size="sm" variant="secondary" onClick={() => void leave()}>
              {t('Cancel')}
            </Button>
            <Button
              size="sm"
              type="submit"
              form={FORM}
              disabled={creating || !name.trim() || (custom && draftIncomplete(draft))}
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {creating ? t('Starting {name}…', { name: label }) : t('Continue')}
            </Button>
          </div>
        )
      }
    >
      {!ready && <Stepper step={created ? 1 : 0} />}
      {ready ? (
        <div className="flex flex-col items-center gap-2 px-5 py-8 text-center" role="status">
          <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-success text-white">
            <Check className="h-6 w-6" strokeWidth={3} />
          </span>
          <p className="text-[15px] font-medium text-main">
            {t('{name} is ready on {computer}', { name: label, computer: device.label })}
          </p>
          <p className="text-[13px] text-secondary">{t('Bots and tasks can now run on it.')}</p>
        </div>
      ) : instance ? (
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
            if (name.trim() && !creating && !(custom && draftIncomplete(draft))) void create()
          }}
        >
          <Field
            label={t('Name')}
            hint={
              taken
                ? t('Another runtime on this computer already has this name.')
                : t(
                    'How this runtime appears on the computer and when choosing a runtime for a Bot or task.',
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
          {ownProvider && (
            <CustomProviderFields
              modal
              provider="opencode"
              draft={draft}
              error={providerError}
              onChange={setDraft}
            />
          )}
        </form>
      )}
    </Modal>
  )
}
