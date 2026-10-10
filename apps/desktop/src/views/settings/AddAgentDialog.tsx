import { Dialog } from '@base-ui/react/dialog'
import clsx from 'clsx'
import { Cloud, Server, X } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { toast } from '../../components/ui/toast'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { AGENT_PROVIDER, AGENT_PROVIDERS } from '../../types/runtime'

import { nextAddAgentStep } from './addAgentFlow'
import { ExternalRuntimeForm } from './ExternalRuntimeForm'
import { ExternalRuntimePasswordForm } from './ExternalRuntimePasswordForm'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'

import type { AddAgentAction, AddAgentStep } from './addAgentFlow'
import type { AgentProvider, RuntimeInstance } from '../../types/runtime'
import type { ReactNode } from 'react'

const TITLE: Record<AddAgentStep, string> = {
  choose: 'Add agent',
  'self-hosted': 'Self-hosted Cloud Agent',
  'self-hosted-password': 'Self-hosted Cloud Agent',
  managed: 'Nuphos Managed Cloud Agent',
}

const MAKER: Record<AgentProvider, string> = {
  'claude-code': 'Anthropic’s',
  codex: 'OpenAI’s',
  grok: 'xAI’s',
  antigravity: 'Google’s',
  opencode: 'The open source',
}

function Choice({
  icon,
  title,
  description,
  selected,
  onClick,
}: {
  icon: ReactNode
  title: string
  description: string
  selected?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors',
        selected
          ? 'border-zViolet-500/70 bg-zViolet-500/10'
          : 'border-zGray-800 hover:border-zGray-700 hover:bg-zGray-800/40',
      )}
    >
      <span className="mt-0.5 text-secondary">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-main">{title}</span>
        <span className="mt-0.5 block text-[12px] text-tertiary">{description}</span>
      </span>
    </button>
  )
}

function ManagedAgentForm({
  teamId,
  onBack,
  onCreated,
}: {
  teamId: string
  onBack: () => void
  onCreated: (instance: RuntimeInstance) => void
}) {
  const [provider, setProvider] = useState<RuntimeInstance['provider']>('claude-code')
  const [saving, setSaving] = useState(false)

  async function create() {
    if (saving) return
    setSaving(true)
    try {
      onCreated(await api.atlasCreateRuntimeInstance(teamId, { provider }))
    } catch (error) {
      toast.apiError('Could not add agent', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {AGENT_PROVIDERS.map((option) => (
          <Choice
            key={option}
            icon={<AgentProviderIcon provider={option} className="h-4 w-4" />}
            title={AGENT_PROVIDER[option].label}
            description={`${MAKER[option]} coding agent. Sign in with ${AGENT_PROVIDER[option].account} next.`}
            selected={provider === option}
            onClick={() => setProvider(option)}
          />
        ))}
      </div>
      <p className="text-[12px] leading-5 text-tertiary">
        The agent keeps its own sign-in; Nuphos does not store it.
      </p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => void create()}
          disabled={saving}
          className="rounded-md bg-zViolet-600 px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-zViolet-500 disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Continue to sign in'}
        </button>
      </div>
    </div>
  )
}

/** One place to add a team agent, from Settings › Agent or the composer's agent picker. */
export function AddAgentDialog({
  teamId,
  onClose,
  onAdded,
}: {
  teamId: string
  onClose: () => void
  onAdded?: (runtimeId: string) => void
}) {
  const [step, setStep] = useState<AddAgentStep>('choose')
  const [signingIn, setSigningIn] = useState<RuntimeInstance | null>(null)
  const go = (action: AddAgentAction) => setStep((current) => nextAddAgentStep(current, action))
  const added = (runtimeId: string) => {
    window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    onAdded?.(runtimeId)
    onClose()
  }

  if (signingIn)
    return (
      <RuntimeLoginDialog
        teamId={teamId}
        instance={signingIn}
        onClose={() => added(signingIn.id)}
      />
    )

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-[1001] w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900 shadow-2xl shadow-black/50 outline-none transition-[opacity,transform] duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:scale-[var(--modal-scale-close)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:scale-[var(--modal-scale)] data-[starting-style]:opacity-0">
          <div className="flex items-center justify-between border-b border-zGray-800 px-5 py-4">
            <Dialog.Title className="text-[14px] font-semibold text-main">
              {TITLE[step]}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800 hover:text-main"
            >
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
            {step === 'choose' && (
              <div className="space-y-2">
                <Choice
                  icon={<Server className="h-4 w-4" />}
                  title="Self-hosted Cloud Agent"
                  description="Connect an agent you run on your own server, with a pairing code from its console."
                  onClick={() => go('self-hosted')}
                />
                <Choice
                  icon={<Cloud className="h-4 w-4" />}
                  title="Nuphos Managed Cloud Agent"
                  description="Nuphos runs and updates the agent for your team. Pick Claude Code, Codex, Grok Build, Antigravity or OpenCode."
                  onClick={() => go('managed')}
                />
              </div>
            )}
            {step === 'self-hosted' && (
              <ExternalRuntimeForm
                onCancel={() => go('back')}
                onUsePassword={() => go('use-password')}
                onPair={(input) => api.atlasPairExternalRuntime(teamId, input)}
                onConnected={(runtime) => added(runtime.id)}
              />
            )}
            {step === 'self-hosted-password' && (
              <ExternalRuntimePasswordForm
                onCancel={() => go('back')}
                onUsePairingCode={() => go('use-pairing')}
                onDetectProvider={async (url, password) =>
                  (await api.atlasProbeExternalRuntimeProvider(teamId, url, password)).provider
                }
                onRegister={async (input) => {
                  added((await api.atlasRegisterExternalRuntime(teamId, input)).id)
                }}
              />
            )}
            {step === 'managed' && (
              <ManagedAgentForm
                teamId={teamId}
                onBack={() => go('back')}
                onCreated={setSigningIn}
              />
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
