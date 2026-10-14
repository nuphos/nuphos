import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { effortLabel, modelChoiceLabel } from '../../../lib/configLabels'
import { effortResetValue } from '../../../lib/effortStops'
import { concreteModelChoices } from '../../../lib/modelChoices'
import { isClaudeCatalog } from '../../../lib/modelGroups'

import { ClaudeModelList } from './ClaudeModelList'
import { HintTooltip } from './modelControlParts'
import { FG_TERTIARY, SURFACE } from './modelControlStyles'
import { ModelEffortPanel } from './ModelEffortPanel'
import { ModelListPanel } from './ModelListPanel'

import type { useSessionConfig } from './useSessionConfig'
import type { SessionConfigOption, SessionConfigState } from '../../../api/session-config-types'

export const EFFORT_SHORTCUT = 'ctrl+shift+m'

function modelName(option: SessionConfigOption) {
  const { current, label } = concreteModelChoices(
    option.options.map((choice) => ({
      ...choice,
      id: choice.value,
      name: modelChoiceLabel(choice),
    })),
    option.currentValue,
  )

  return label ?? current ?? ''
}

function effortName(option: SessionConfigOption | undefined) {
  const choice = option?.options.find((candidate) => candidate.value === option.currentValue)

  return choice && choice.value !== 'default' ? effortLabel(choice) : ''
}

function modelHint(
  status: SessionConfigState['status'] | undefined,
  hasModel: boolean,
  busy: boolean,
  stalled: boolean,
) {
  if (status === 'offline')
    return 'This agent is offline. Model settings return when it reconnects.'
  if (busy && stalled)
    return "This agent hasn't responded in a while — it may be stuck. Try reconnecting below."
  if (busy) return 'Changes apply after this reply.'
  if (status === 'dormant' && !hasModel)
    return 'Send a message to start this session before changing model settings.'
}

/** ⌃⇧M belongs to the composer that has focus, or to the only one on screen. */
function ownsShortcut(chip: HTMLElement) {
  let scope = chip.parentElement

  while (scope && !scope.querySelector('[aria-label="Message"]')) scope = scope.parentElement
  const active = document.activeElement

  if (scope && active && scope.contains(active)) return true

  return (
    (!active || active === document.body) &&
    [...document.querySelectorAll<HTMLElement>('[data-model-chip]')].filter((other) =>
      other.checkVisibility(),
    ).length === 1
  )
}

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
  const blocked =
    disabled ||
    saving ||
    Boolean(error) ||
    slow ||
    (status !== 'ready' && status !== 'dormant' && status !== 'busy')
  const hint = modelHint(status, Boolean(model), busy, stalled)
  // Before the first reply, the level a model starts on is the runtime's default.
  const effortKey = model?.currentValue ?? ''

  if (status === 'dormant' && effort && !(effortKey in initialEffort))
    setInitialEffort({ ...initialEffort, [effortKey]: effort.currentValue })
  const setOpen = control.setOpen

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

      if (!chip?.isConnected || !ownsShortcut(chip)) return
      event.preventDefault()
      setView(effort ? 'effort' : 'models')
      setOpen(true)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [effort, setOpen])

  const effortOpen = control.open && view === 'effort'

  // A runtime that exposes no model controls gets no picker at all.
  if (status === 'unsupported') return null
  const select = (configId: string, value: string) => control.select({ configId, value })
  const pickModel = (value: string) => {
    if (!model) return
    select(model.id, value)
    if (effort) setView('effort')
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
      onOpenChange={(open) => {
        if (open) setView(effort ? 'effort' : 'models')
        control.setOpen(open)
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
          aria-label={`Model settings: ${[name, level].filter(Boolean).join(' ')}`}
          className={clsx(
            'flex h-[31px] min-w-0 max-w-64 items-center gap-[4px] rounded-full pl-[10.5px] pr-[9px] text-[13.5px] text-main outline-none transition-colors',
            'hover:bg-[rgba(var(--color-text-base),0.07)] focus-visible:bg-[rgba(var(--color-text-base),0.07)] data-[popup-open]:bg-[rgba(var(--color-text-base),0.07)]',
          )}
        >
          {saving && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
          {effortOpen ? (
            <span className={clsx('truncate px-[18px]', FG_TERTIARY)}>Select effort</span>
          ) : name ? (
            <>
              <span className="min-w-0 truncate">{name}</span>
              {level && (
                <span className={clsx('shrink-0 whitespace-nowrap', FG_TERTIARY)}>{level}</span>
              )}
            </>
          ) : (
            <span
              aria-label="Loading model"
              className="h-3 w-24 animate-pulse rounded bg-zGray-700/60 motion-reduce:animate-none"
            />
          )}
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
            initialFocus={view !== 'effort'}
            className={clsx(SURFACE, 't-dropdown is-open w-[280px] rounded-[16px] outline-none')}
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
                  onSelectFast={(value) => fast && select(fast.id, value)}
                />
              ) : (
                <ModelListPanel
                  model={model}
                  offerDefault={status === 'dormant'}
                  blocked={blocked}
                  onSelect={pickModel}
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
