import { Dialog } from '@base-ui/react/dialog'
import clsx from 'clsx'
import { Box, Laptop, Loader2, Server, X } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { AgentProviderIcon } from '../../components/agent/panel/icons'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { useAutoHeight } from '../../hooks/useAutoHeight'
import { useDialogPresence } from '../../hooks/useDialogPresence'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useTextSwap } from '../../hooks/useTextSwap'
import { AGENT_PROVIDER } from '../../types/runtime'

import { nextAddAgentStep } from './addAgentFlow'
import { JoinDialog } from './BoxParts'
import { boxSetupProblem } from './boxPresentation'
import { ExternalRuntimeForm } from './ExternalRuntimeForm'
import { ExternalRuntimePasswordForm } from './ExternalRuntimePasswordForm'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'
import { useBoxAvailable } from './useAgentDevices'
import { useBoxSetup } from './useBoxSetup'
import { useBoxUsage } from './useBoxUsage'

import type { AddAgentAction, AddAgentStep } from './addAgentFlow'
import type { BoxJoin } from './BoxParts'
import type { RuntimeInstance } from '../../types/runtime'
import type { CSSProperties, ReactNode } from 'react'

const TITLE: Record<AddAgentStep, string> = {
  choose: 'Add agent',
  'self-hosted': 'Self-hosted Cloud Agent',
  'self-hosted-password': 'Self-hosted Cloud Agent',
  box: 'New Box',
}

function Choice({
  icon,
  title,
  description,
  selected,
  disabled,
  onClick,
}: {
  icon: ReactNode
  title: string
  description: string
  selected?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={clsx(
        'flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
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

/** Makes a Box, waits for its agents, then hands the chosen one to sign-in. */
function BoxAgentForm({
  teamId,
  onBack,
  onChosen,
  onOpenBilling,
}: {
  teamId: string
  onBack: () => void
  onChosen: (instance: RuntimeInstance) => void
  onOpenBilling?: () => void
}) {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const box = useBoxSetup(teamId, deviceId, setDeviceId, onOpenBilling)
  const button =
    'rounded-md px-3 py-1.5 text-[12.5px] text-secondary hover:bg-zGray-800/60 disabled:opacity-50'

  return (
    <div className="space-y-4">
      {box.phase === 'ready' ? (
        <div className="space-y-2">
          <p className="text-[12.5px] text-secondary">
            Your Box is running. Choose an agent to sign in.
          </p>
          {box.agents.map((agent) => (
            <Choice
              key={agent.id}
              icon={<AgentProviderIcon provider={agent.provider} className="h-4 w-4" />}
              title={AGENT_PROVIDER[agent.provider].label}
              description={`Sign in with ${AGENT_PROVIDER[agent.provider].account}.`}
              onClick={() => onChosen(agent)}
            />
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-[12.5px] leading-5 text-secondary" role="status">
          {box.phase === 'starting' && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
          {box.phase === 'idle' &&
            'A Box is a Linux computer in the cloud with Claude Code and Codex on it. Its agents keep working when your computer sleeps, and only you can use it.'}
          {box.phase === 'starting' &&
            'Starting the computer and its agents, usually 10–30 seconds…'}
          {boxSetupProblem(box.phase)}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onBack} disabled={box.creating} className={button}>
          Back
        </button>
        {box.phase === 'idle' && (
          <Button size="sm" type="button" onClick={() => void box.create()} disabled={box.creating}>
            {box.creating ? 'Creating…' : 'Create Box'}
          </Button>
        )}
      </div>
    </div>
  )
}

/** One place to add a team agent, from Settings › Agent or the composer's agent picker. */
export function AddAgentDialog({
  teamId,
  onClose,
  onAdded,
  onOpenBilling,
}: {
  teamId: string
  onClose: () => void
  onAdded?: (runtimeId: string) => void
  /** Without it, a team with no Box plan can only read where to get one. */
  onOpenBilling?: () => void
}) {
  const [step, setStep] = useState<AddAgentStep>('choose')
  const boxAvailable = useBoxAvailable()
  const noPlan = useBoxUsage(teamId).usage?.limitVcpus === 0
  const [signingIn, setSigningIn] = useState<RuntimeInstance | null>(null)
  const [join, setJoin] = useState<BoxJoin | null>(null)
  // Slide direction of the step that just entered: deeper from the right, back
  // from the left, the pairing ↔ password swap in place. null until the first
  // move, so opening the dialog only plays the dialog's own transition.
  const [dir, setDir] = useState<number | null>(null)
  const go = (action: AddAgentAction) => {
    setDir(action === 'back' ? -1 : action === 'self-hosted' || action === 'box' ? 1 : 0)
    setStep((current) => nextAddAgentStep(current, action))
  }
  const presence = useDialogPresence(onClose)
  const autoHeight = useAutoHeight<HTMLDivElement>()
  const { ref: titleRef, text: title } = useTextSwap<HTMLSpanElement>(TITLE[step])
  const added = (runtimeId: string) => {
    window.dispatchEvent(new Event(RUNTIME_INSTANCES_CHANGED))
    onAdded?.(runtimeId)
    onClose()
  }

  if (join) return <JoinDialog join={join} onClose={onClose} />
  if (signingIn)
    return (
      <RuntimeLoginDialog
        teamId={teamId}
        instance={signingIn}
        onClose={() => added(signingIn.id)}
      />
    )

  return (
    <Dialog.Root {...presence}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm transition-opacity duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-[1001] w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900 shadow-2xl shadow-black/50 outline-none transition-[opacity,transform] duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:scale-[var(--modal-scale-close)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:scale-[var(--modal-scale)] data-[starting-style]:opacity-0 motion-reduce:transition-none">
          <div className="flex items-center justify-between border-b border-zGray-800 px-5 py-4">
            <Dialog.Title className="text-[14px] font-semibold text-main">
              <span ref={titleRef} className="t-text-swap">
                {title}
              </span>
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary hover:bg-zGray-800 hover:text-main"
            >
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            <div className="t-resize overflow-hidden">
              <div ref={autoHeight} className="px-5 py-4">
                <div
                  key={step}
                  className="t-nav-stack__layer"
                  data-anim={dir === null ? undefined : 'enter'}
                  style={{ '--nav-dir': dir ?? 0 } as CSSProperties}
                >
                  {step === 'choose' && (
                    <div className="space-y-2">
                      {boxAvailable && (
                        <Choice
                          icon={<Box className="h-4 w-4" />}
                          title="New Box"
                          description={
                            noPlan
                              ? 'Needs a Box plan → Billing'
                              : 'A cloud computer Nuphos runs for you, with Claude Code and Codex. Sign in with your own account.'
                          }
                          disabled={noPlan && !onOpenBilling}
                          onClick={() => {
                            if (!noPlan) return go('box')
                            onClose()
                            onOpenBilling?.()
                          }}
                        />
                      )}
                      {boxAvailable && (
                        <Choice
                          icon={<Laptop className="h-4 w-4" />}
                          title="Connect your own machine"
                          description="Make a computer or server you run into a Box, with a one-time join command."
                          onClick={() =>
                            void api
                              .boxJoinToken()
                              .then(setJoin, (error: unknown) =>
                                toast.apiError('Could not make a join command', error),
                              )
                          }
                        />
                      )}
                      <Choice
                        icon={<Server className="h-4 w-4" />}
                        title="Self-hosted Cloud Agent"
                        description="Connect an agent you run on your own server, with a pairing code from its console."
                        onClick={() => go('self-hosted')}
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
                        (await api.atlasProbeExternalRuntimeProvider(teamId, url, password))
                          .provider
                      }
                      onRegister={async (input) => {
                        added((await api.atlasRegisterExternalRuntime(teamId, input)).id)
                      }}
                    />
                  )}
                  {step === 'box' && (
                    <BoxAgentForm
                      teamId={teamId}
                      onBack={() => go('back')}
                      onChosen={setSigningIn}
                      onOpenBilling={
                        onOpenBilling &&
                        (() => {
                          onClose()
                          onOpenBilling()
                        })
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
