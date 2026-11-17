import { Dialog } from '@base-ui/react/dialog'
import { useState } from 'react'

import { t } from '../../../i18n'
import { managesRuntime } from '../../../views/settings/agentPresentation'
import {
  editsRuntime,
  fallbackCandidates,
  offersFallbackSetup,
  saveFallbackThenMove,
} from '../../../views/settings/runtimeFallback'
import { useRuntimeFallback } from '../../../views/settings/RuntimeFallbackPicker'
import { useAgentDevices } from '../../../views/settings/useAgentDevices'
import { Button } from '../../ui/button'
import { toast } from '../../ui/toast'

import { RuntimeSelector } from './RuntimeSelector'
import { latestFailure, turnSwitchAgent } from './turnFailureActions'

import type { PanelViewCtx } from './ctx'
import type { RuntimeControl } from './RuntimeSelector'
import type { RuntimeInstance } from '../../../types/runtime'

const POPUP =
  'fixed left-1/2 top-1/2 z-[1001] flex w-[480px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-line-control bg-surface-sheet p-6 text-main shadow-2xl shadow-black/30 outline-none'

/**
 * The Task's latest turn failed because its runtime could not run it, and that runtime has no
 * fallback: offers to set one for the team (the setting runtime details shows) and move there.
 */
export function useTurnFallbackSetup(c: PanelViewCtx, control: RuntimeControl | undefined) {
  const teamId = c.teamId ?? ''
  const failure = latestFailure(c.activeTab)
  const failed = Boolean(teamId && failure?.cause)
  const runtime = c.runtimeInstances.find((instance) => instance.id === c.activeTab?.runtimeId)
  const device = useAgentDevices(() => 0, teamId, {
    teamId,
    enabled: failed && Boolean(runtime?.local),
  }).list?.devices.find((entry) => entry.deviceId === runtime?.local?.deviceId)
  const { fallbacks, save } = useRuntimeFallback(teamId, runtime?.id, failed)
  const [open, setOpen] = useState(false)
  const move = control?.onSelect
  const offered = offersFallbackSetup({
    cause: failure?.cause,
    runtime,
    edits: runtime ? editsRuntime(runtime, managesRuntime(runtime, device, c.isTeamAdmin)) : false,
    canMove: Boolean(move),
    fallbacks,
  })

  return {
    // The failure line's actions: Switch runtime, and this setup while it is offered.
    turnSwitch: turnSwitchAgent(c.activeTab, offered ? () => setOpen(true) : undefined),
    dialog: control && runtime && move && (
      <FallbackSetupDialog
        open={open && offered}
        runtime={runtime}
        candidates={fallbackCandidates(control.options ?? [], runtime.id)}
        control={control}
        onClose={() => setOpen(false)}
        onManage={c.onOpenAgentSettings}
        onSave={(next) =>
          saveFallbackThenMove(
            () => save(next),
            () => {
              setOpen(false)
              toast.success(t('Fallback saved for {name}', { name: runtime.label }))
              move(next)
            },
          )
        }
      />
    ),
  }
}

function FallbackSetupDialog({
  open,
  runtime,
  candidates,
  control,
  onClose,
  onManage,
  onSave,
}: {
  open: boolean
  runtime: RuntimeInstance
  candidates: RuntimeInstance[]
  control: RuntimeControl
  onClose: () => void
  onManage?: () => void
  onSave: (runtimeId: string) => Promise<boolean>
}) {
  const [choice, setChoice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const chosen = candidates.find((instance) => instance.id === choice)
  const close = () => {
    setChoice(null)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !saving && close()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[1000] bg-black/40" />
        <Dialog.Popup className={POPUP}>
          <div className="border-b border-line-control pb-4">
            <Dialog.Title className="text-[18px] font-semibold">
              {t('Set up fallback')}
            </Dialog.Title>
            <p className="mt-1 text-[13px] text-secondary">
              {t('For {name} · shared with your team', { name: runtime.label })}
            </p>
          </div>
          <div>
            <p className="text-[14px] font-medium">
              {t('When {name} cannot run a turn', { name: runtime.label })}
            </p>
            <Dialog.Description className="mt-1 text-[13px] text-secondary">
              {t('Usage limit, offline, or sign-in required')}
            </Dialog.Description>
          </div>
          {candidates.length > 0 ? (
            <RuntimeSelector
              teamId={control.teamId}
              value={chosen ?? null}
              options={candidates}
              quotas={control.quotas}
              selectDisabled={saving}
              onSelect={setChoice}
            />
          ) : (
            <p className="rounded-lg border border-line-control px-3 py-2.5 text-[13px] text-secondary">
              {t('No other runtime can take over.')}{' '}
              {onManage && (
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-2"
                  onClick={() => {
                    close()
                    onManage()
                  }}
                >
                  {t('Manage runtimes')}
                </button>
              )}
            </p>
          )}
          <p className="text-[12.5px] text-secondary">
            {t(
              'Task history moves. Files in the current runtime’s working directory may stay behind.',
            )}
          </p>
          <div className="flex items-center justify-between gap-3">
            <Button size="sm" variant="secondary" disabled={saving} onClick={close}>
              {t('Cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!chosen || saving}
              onClick={() => {
                if (!chosen) return
                setSaving(true)
                void onSave(chosen.id).then((moved) => {
                  setSaving(false)
                  if (moved) setChoice(null)
                })
              }}
            >
              {t('Save & switch this Task')}
            </Button>
          </div>
          <p className="text-[11.5px] text-tertiary">
            {t('Saves the shared setting and moves this Task once.')}
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
