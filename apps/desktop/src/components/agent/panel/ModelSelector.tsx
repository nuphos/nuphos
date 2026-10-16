import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { effortLabel } from '../../../lib/configLabels'
import { effortResetValue, effortStops } from '../../../lib/effortStops'
import { isClaudeCatalog } from '../../../lib/modelGroups'

import { ClaudeModelList } from './ClaudeModelList'
import { ModelChipLabel } from './ModelChipLabel'
import { HintTooltip } from './modelControlParts'
import { FG_TERTIARY, SURFACE } from './modelControlStyles'
import { ModelEffortPanel } from './ModelEffortPanel'
import { ModelListPanel } from './ModelListPanel'
import {
  composerOf,
  EFFORT_SHORTCUT,
  effortName,
  modelHint,
  modelName,
  ownsShortcut,
} from './modelSelectorParts'

import type { useSessionConfig } from './useSessionConfig'

export type ModelControl = Pick<
  ReturnType<typeof useSessionConfig>,
  'data' | 'loading' | 'slow' | 'saving' | 'error' | 'stalled' | 'queued' | 'open' | 'select'
> & { setOpen: (open: boolean) => void; refresh: () => void }

export function ModelSelector({
  control,
  disabled,
  streaming,
}: {
  control: ModelControl
  disabled: boolean
  streaming: boolean
}) {
  const { data, loading, slow, saving, error, stalled } = control
  const [view, setView] = useState<'effort' | 'models'>('effort')
  const chipRef = useRef<HTMLButtonElement>(null)
  const sliderRef = useRef<HTMLInputElement>(null)
  const [initialEffort, setInitialEffort] = useState<Record<string, string>>({})
  const options = data?.options.map((option) => {
    const queued = control.queued?.find((selection) => selection.configId === option.id)

    return queued ? { ...option, currentValue: queued.value } : option
  })
  const model = options?.find((option) => option.kind === 'model')
  const effort = options?.find((option) => option.kind === 'effort')
  const fast = options?.find((option) => option.kind === 'fast')
  const status = data?.status
  const busy = status === 'busy' || streaming
  const name = model ? modelName(model) : status === 'offline' ? 'Model unavailable' : ''
  const level = effortName(effort)
  const effortLevels = [
    ...new Set([level, ...effortStops(effort?.options ?? []).map((choice) => effortLabel(choice))]),
  ].filter(Boolean)
  const blocked =
    disabled ||
    saving ||
    Boolean(error) ||
    slow ||
    (status !== 'ready' && status !== 'dormant' && status !== 'busy')
  const hint = modelHint(status, Boolean(model), busy, stalled)
  const effortKey = model?.currentValue ?? ''

  // Reset falls back to the level each model started on in this chat.
  if (effort && !(effortKey in initialEffort))
    setInitialEffort({ ...initialEffort, [effortKey]: effort.currentValue })
  const setOpen = control.setOpen
  const open = control.open

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !event.ctrlKey ||
        !event.shiftKey ||
        event.metaKey ||
        event.altKey ||
        event.code !== 'KeyM'
      )
        return
      const chip = chipRef.current

      // ⌃⇧M again closes it, wherever focus went inside the popover.
      if (open) {
        event.preventDefault()
        setOpen(false)

        return
      }
      if (!chip?.isConnected || !ownsShortcut(chip)) return
      event.preventDefault()
      setView(effort ? 'effort' : 'models')
      setOpen(true)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [effort, open, setOpen])

  const effortOpen = control.open && view === 'effort'

  // A runtime that exposes no model controls gets no picker at all.
  if (status === 'unsupported') return null
  const select = (configId: string, value: string) => control.select({ configId, value })
  const pickModel = (value: string) => {
    if (!model) return
    select(model.id, value)
    control.setOpen(false)
  }
  const footer = [
    (loading || slow) &&
      !error &&
      (slow ? 'The agent is reconnecting. This may take a moment.' : 'Getting model settings…'),
    error,
    error && model && 'Showing last synced settings.',
    control.queued ? 'Selected for the next reply.' : hint,
    disabled &&
      !busy &&
      status === 'ready' &&
      'Available when this conversation is ready for your next message.',
  ].filter(Boolean)

  return (
    <Popover.Root
      open={control.open}
      onOpenChange={(next, details) => {
        // Escape from the model list steps back to effort; a second one closes.
        if (!next && details.reason === 'escape-key' && view === 'models' && effort) {
          details.cancel()
          setView('effort')

          return
        }
        if (next) setView(effort ? 'effort' : 'models')
        control.setOpen(next)
      }}
      // Arrow keys move the effort slider as soon as it shows, as in Codex.
      onOpenChangeComplete={(open) => {
        if (open) sliderRef.current?.focus()
      }}
    >
      <HintTooltip label="Select effort" combo={EFFORT_SHORTCUT} disabled={control.open || !effort}>
        <Popover.Trigger
          ref={chipRef}
          data-model-chip=""
          aria-label={`Model settings: ${[name, level].filter(Boolean).join(' ')}${fast?.currentValue === 'on' ? ', fast mode on' : ''}`}
          className={clsx(
            'flex h-[31px] min-w-0 max-w-64 items-center gap-[4px] rounded-full pl-[10.5px] pr-[9px] text-[13.5px] text-main outline-none transition-colors',
            'hover:bg-[rgba(var(--color-text-base),0.07)] focus-visible:bg-[rgba(var(--color-text-base),0.07)] data-[popup-open]:bg-[rgba(var(--color-text-base),0.07)]',
          )}
        >
          {saving && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
          <ModelChipLabel
            name={name}
            level={level}
            levels={effortLevels}
            choosingEffort={effortOpen}
            fast={fast?.currentValue === 'on'}
          />
          <ChevronDown
            size={14}
            strokeWidth={1.8}
            className={clsx('ml-[2px] shrink-0', FG_TERTIARY)}
          />
        </Popover.Trigger>
      </HintTooltip>
      <Popover.Portal>
        <Popover.Positioner side="top" align="center" sideOffset={8} className="z-[1000]">
          <Popover.Popup
            // Closing returns to the message box, so typing carries on.
            finalFocus={() =>
              composerOf(chipRef.current)?.querySelector<HTMLElement>('[aria-label="Message"]') ??
              true
            }
            initialFocus={view !== 'effort'}
            className={clsx(SURFACE, 'model-picker-enter w-[280px] rounded-[16px] outline-none')}
          >
            {view === 'effort' && effort && model && (
              <ModelEffortPanel
                effort={effort}
                fast={fast}
                modelName={name}
                resetValue={effortResetValue(effort.options, initialEffort[effortKey])}
                blocked={blocked && !saving}
                saving={saving}
                sliderRef={sliderRef}
                onSelect={select}
                onOpenModels={() => setView('models')}
              />
            )}
            {(view === 'models' || !effort) &&
              model &&
              // Each runtime's list follows its own app: Claude's menu or Codex's.
              (isClaudeCatalog(model.options) ? (
                <ClaudeModelList
                  model={model}
                  fast={fast}
                  blocked={blocked}
                  onSelect={pickModel}
                  onBack={effort ? () => setView('effort') : undefined}
                  onSelectFast={(value) => fast && select(fast.id, value)}
                />
              ) : (
                <ModelListPanel
                  model={model}
                  offerDefault={status === 'dormant'}
                  blocked={blocked}
                  onSelect={pickModel}
                  onBack={effort ? () => setView('effort') : undefined}
                />
              ))}
            {footer.length > 0 && (
              <div
                className={clsx(
                  'mx-[13.5px] border-t border-[rgba(var(--color-text-base),0.06)] py-[8px] text-center text-[12px] leading-[16px]',
                  model ? '' : 'border-t-0',
                  FG_TERTIARY,
                )}
              >
                {footer.map((line) => (
                  <p key={String(line)} role={line === error ? 'alert' : 'status'}>
                    {line}
                  </p>
                ))}
                {(error || stalled) && (
                  <button
                    type="button"
                    disabled={saving || loading}
                    onClick={control.refresh}
                    className="mx-auto mt-[6px] flex items-center gap-[6px] rounded-[6px] px-[8px] py-[3px] text-main hover:bg-[rgba(var(--color-text-base),0.08)] disabled:opacity-50"
                  >
                    {loading || saving ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                    Retry connection
                  </button>
                )}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
