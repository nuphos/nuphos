import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useAutoHeight } from '../../hooks/useAutoHeight'
import { useDialogPresence } from '../../hooks/useDialogPresence'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useTextSwap } from '../../hooks/useTextSwap'

import { AddAgentChoices } from './AddAgentChoice'
import { nextAddAgentStep } from './addAgentFlow'
import { BoxAgentForm } from './BoxAgentStep'
import { JoinDialog } from './BoxParts'
import { ExternalRuntimeForm } from './ExternalRuntimeForm'
import { ExternalRuntimePasswordForm } from './ExternalRuntimePasswordForm'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'
import { useBoxAvailable } from './useAgentDevices'

import type { AddAgentAction, AddAgentStep } from './addAgentFlow'
import type { BoxJoin } from './BoxParts'
import type { RuntimeInstance } from '../../types/runtime'
import type { CSSProperties } from 'react'

const TITLE: Record<AddAgentStep, string> = {
  choose: 'Add agent',
  'self-hosted': 'Self-hosted Cloud Agent',
  'self-hosted-password': 'Self-hosted Cloud Agent',
  box: 'New Box',
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
  const boxAvailable = useBoxAvailable()
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
  // The Box step's say on closing, so a Box being made or the plans over it keep the dialog open.
  const closeGuard = useRef<(() => boolean) | null>(null)
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
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
    <Dialog.Root
      {...presence}
      onOpenChange={(next) => {
        if (next || (closeGuard.current?.() ?? true)) presence.onOpenChange(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm transition-opacity duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-[1001] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-zGray-800 bg-zGray-900 shadow-2xl shadow-black/50 outline-none transition-[opacity,transform] duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:scale-[var(--modal-scale-close)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:scale-[var(--modal-scale)] data-[starting-style]:opacity-0 motion-reduce:transition-none">
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
                    <AddAgentChoices
                      boxAvailable={boxAvailable}
                      footer={footer}
                      onPick={go}
                      onJoin={() =>
                        void api
                          .boxJoinToken()
                          .then(setJoin, (error: unknown) =>
                            toast.apiError('Could not make a join command', error),
                          )
                      }
                      onCancel={() => presence.onOpenChange(false)}
                    />
                  )}
                  {step === 'self-hosted' && (
                    <ExternalRuntimeForm
                      footer={footer}
                      onCancel={() => go('back')}
                      onUsePassword={() => go('use-password')}
                      onPair={(input) => api.atlasPairExternalRuntime(teamId, input)}
                      onConnected={(runtime) => added(runtime.id)}
                    />
                  )}
                  {step === 'self-hosted-password' && (
                    <ExternalRuntimePasswordForm
                      footer={footer}
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
                      footer={footer}
                      onCloseGuard={(guard) => {
                        closeGuard.current = guard
                      }}
                      onBack={() => go('back')}
                      onChosen={setSigningIn}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
          {/* Every step's actions, pinned below the scrolling body as in Modal's footer. */}
          <div ref={setFooter} className="border-t border-zGray-800" />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
