import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../../api'
import { toast } from '../../components/ui/toast'
import { useAutoHeight } from '../../hooks/useAutoHeight'
import { useDialogPresence } from '../../hooks/useDialogPresence'
import { RUNTIME_INSTANCES_CHANGED } from '../../hooks/useRuntimeInstances'
import { useTextSwap } from '../../hooks/useTextSwap'
import { t } from '../../i18n'

import { AddAgentChoices } from './AddAgentChoice'
import { BoxAgentForm } from './BoxAgentStep'
import { JoinDialog } from './JoinDialog'
import { RuntimeLoginDialog } from './RuntimeLoginDialog'
import { useAgentDevices } from './useAgentDevices'
import { useInstaboxAccounts } from './useInstaboxAccounts'

import type { BoxJoin } from './joinCommand'
import type { RuntimeInstance } from '../../types/runtime'
import type { CSSProperties } from 'react'

type Step = 'choose' | 'box'

const TITLE: Record<Step, string> = {
  choose: t('Add computer'),
  box: t('Nuphos cloud computer'),
}

/** The one place to add a computer (and so its runtimes), from the Runtimes page or the composer's agent picker. */
export function AddAgentDialog({
  teamId,
  onClose,
  onAdded,
}: {
  teamId: string
  onClose: () => void
  onAdded?: (runtimeId: string) => void
}) {
  const [step, setStep] = useState<Step>('choose')
  const devices = useAgentDevices(() => 0, teamId, { teamId }).list
  const deploymentBoxes = devices?.boxAvailable === true
  const instaboxAccounts = useInstaboxAccounts(teamId)
  // Only administrators create one, on the deployment's or the team's own instabox account;
  // everyone else adds their own computer.
  const boxAvailable =
    devices?.canCreateBox === true && (deploymentBoxes || instaboxAccounts.length > 0)
  const [signingIn, setSigningIn] = useState<RuntimeInstance | null>(null)
  const [join, setJoin] = useState<BoxJoin | null>(null)
  // Slide direction of the step that just entered: deeper from the right, back
  // from the left. null until the first move, so opening the dialog only plays
  // the dialog's own transition.
  const [dir, setDir] = useState<number | null>(null)
  const go = (next: Step) => {
    setDir(next === 'box' ? 1 : -1)
    setStep(next)
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
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-[1001] w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-line-control bg-surface-sheet shadow-2xl shadow-black/50 outline-none transition-[opacity,transform] duration-[var(--modal-open-dur)] ease-[var(--modal-ease)] data-[ending-style]:scale-[var(--modal-scale-close)] data-[ending-style]:opacity-0 data-[ending-style]:duration-[var(--modal-close-dur)] data-[starting-style]:scale-[var(--modal-scale)] data-[starting-style]:opacity-0 motion-reduce:transition-none">
          <div className="flex items-center justify-between border-b border-line-control px-5 py-4">
            <Dialog.Title className="text-[14px] font-semibold text-main">
              <span ref={titleRef} className="t-text-swap">
                {title}
              </span>
            </Dialog.Title>
            <Dialog.Close
              aria-label={t('Close')}
              className="flex h-7 w-7 items-center justify-center rounded-md text-tertiary hover:bg-state-hover hover:text-main"
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
                      onCloud={() => go('box')}
                      onJoin={() =>
                        void api
                          .boxJoinToken()
                          .then(setJoin, (error: unknown) =>
                            toast.apiError(t('Could not make a join command'), error),
                          )
                      }
                      onCancel={() => presence.onOpenChange(false)}
                    />
                  )}
                  {step === 'box' && (
                    <BoxAgentForm
                      teamId={teamId}
                      accounts={instaboxAccounts}
                      deployment={deploymentBoxes}
                      footer={footer}
                      onCloseGuard={(guard) => {
                        closeGuard.current = guard
                      }}
                      onBack={() => go('choose')}
                      onChosen={setSigningIn}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
          {/* Every step's actions, pinned below the scrolling body as in Modal's footer. */}
          <div ref={setFooter} className="border-t border-line-control" />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
