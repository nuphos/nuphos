import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { ChevronDown, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { effortLabel } from '../../../lib/configLabels'
import { effortResetValue, effortStops } from '../../../lib/effortStops'
import { Kbd } from '../../ui/kbd'
import { Menu, MenuContent } from '../../ui/menu'
import { Tooltip } from '../../ui/tooltip'

import { ModelChipLabel } from './ModelChipLabel'
import { ModelEffortPanel } from './ModelEffortPanel'
import { ModelFooter, ModelMenuFooter } from './ModelFooter'
import { ModelMenu } from './ModelMenu'
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
  'data' | 'loading' | 'slow' | 'saving' | 'error' | 'queued' | 'open' | 'select'
> & { setOpen: (open: boolean) => void; refresh: () => void }

export function ModelSelector({
  control,
  disabled,
  hero = false,
}: {
  control: ModelControl
  disabled: boolean
  /** Sized like the hero composer's other controls; compact otherwise. */
  hero?: boolean
}) {
  const { data, loading, slow, saving, error } = control
  const [view, setView] = useState<'effort' | 'models'>('effort')
  const chipRef = useRef<HTMLButtonElement>(null)
  const sliderRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const options = data?.options.map((option) => {
    const queued = control.queued?.find((selection) => selection.configId === option.id)

    return queued ? { ...option, currentValue: queued.value } : option
  })
  const model = options?.find((option) => option.kind === 'model')
  const effort = options?.find((option) => option.kind === 'effort')
  const fast = options?.find((option) => option.kind === 'fast')
  const status = data?.status
  const busy = status === 'busy'
  let name = slow ? 'Connecting…' : 'Model settings'

  if (error || status === 'offline') name = 'Model unavailable'
  if (model) name = modelName(model) || name
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
  const hint = modelHint(status, Boolean(model), busy)

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

  // Effort is a popover, since a slider is not a menu item; the model list is a
  // menu. Both hang off the chip, and one open flag shows whichever view is on.
  const showModels = view === 'models' || !effort
  const modelsOpen = control.open && showModels && Boolean(model)
  const effortOpen = control.open && !modelsOpen

  // A runtime that exposes no model controls gets no picker at all.
  if (status === 'unsupported') return null
  const select = (configId: string, value: string) => control.select({ configId, value })
  const pickModel = (value: string) => {
    if (!model) return
    if (value !== model.currentValue) select(model.id, value)
    control.setOpen(false)
  }
  const footer = {
    lines: [
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
    ].filter((line): line is string => Boolean(line)),
    error: error ?? undefined,
    onRetry: error || status === 'offline' ? control.refresh : undefined,
    retrying: loading || saving,
  }
  // Closing returns to the message box, so typing carries on; switching views
  // leaves focus to the view that opens.
  const finalFocus = () =>
    !control.open &&
    (composerOf(chipRef.current)?.querySelector<HTMLElement>('[aria-label="Message"]') ?? true)

  return (
    <>
      <Popover.Root
        open={effortOpen}
        onOpenChange={(next) => {
          if (next) setView(effort ? 'effort' : 'models')
          control.setOpen(next)
        }}
        // Arrow keys move the effort slider as soon as it shows.
        onOpenChangeComplete={(shown) => {
          if (shown) sliderRef.current?.focus()
        }}
      >
        <Tooltip
          content={
            <span className="flex items-center gap-2">
              Select effort <Kbd combo={EFFORT_SHORTCUT} />
            </span>
          }
          disabled={control.open || !effort}
          triggerClassName="min-w-0"
        >
          <Popover.Trigger
            ref={chipRef}
            data-model-chip=""
            aria-label={`Model settings: ${[name, level].filter(Boolean).join(' ')}${fast?.currentValue === 'on' ? ', fast mode on' : ''}`}
            // A filled pill at rest, so opening it changes nothing but the text.
            className={clsx(
              hero ? 'h-8' : 'h-7',
              'flex min-w-0 max-w-64 items-center gap-1 rounded-full px-2 text-[13px] text-main outline-none transition-colors hover:bg-zGray-800 focus-visible:bg-zGray-800',
            )}
          >
            {saving && <Loader2 className="h-3 w-3 shrink-0 animate-spin" />}
            <ModelChipLabel
              name={name}
              loading={loading && !slow && !error && !data}
              level={level}
              levels={effortLevels}
              choosingEffort={effortOpen && Boolean(effort)}
              fast={fast?.currentValue === 'on'}
            />
            <ChevronDown
              size={14}
              strokeWidth={1.8}
              className="hidden shrink-0 text-tertiary @[320px]:block"
            />
          </Popover.Trigger>
        </Tooltip>
        <Popover.Portal>
          <Popover.Positioner side="top" align="center" sideOffset={8} className="z-[1000]">
            <Popover.Popup
              finalFocus={finalFocus}
              className={(state) =>
                clsx(
                  't-dropdown w-72 rounded-xl border border-zGray-800/60 bg-main shadow-[0_10px_28px_-6px_rgba(0,0,0,0.6)] outline-none',
                  state.open && 'is-open',
                  state.transitionStatus === 'ending' && 'is-closing',
                )
              }
              style={{ transformOrigin: 'bottom center' }}
            >
              {!showModels && effort && model && (
                <ModelEffortPanel
                  effort={effort}
                  fast={fast}
                  modelName={name}
                  resetValue={effortResetValue(effort.options)}
                  blocked={blocked && !saving}
                  saving={saving}
                  sliderRef={sliderRef}
                  onSelect={select}
                  onOpenModels={() => setView('models')}
                />
              )}
              <ModelFooter {...footer} divided={Boolean(model)} />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <Menu
        open={modelsOpen}
        onOpenChange={(next, details) => {
          // This menu has no trigger of its own. Base UI still reports trigger and
          // sibling closes when "More models" opens or the view steps back to
          // effort; neither is the user closing it.
          if (details.reason === 'trigger-hover' || details.reason === 'sibling-open') return
          // Escape from the model list steps back to effort; a second one closes.
          if (!next && details.reason === 'escape-key' && effort) setView('effort')
          else control.setOpen(next)
        }}
        // Start on the current model, so ↑/↓ move from where the user is.
        onOpenChangeComplete={(shown) => {
          if (shown) menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
        }}
      >
        <MenuContent
          ref={menuRef}
          anchor={chipRef}
          side="top"
          align="center"
          sideOffset={8}
          finalFocus={finalFocus}
          className="w-72 rounded-xl"
        >
          {model && (
            <ModelMenu
              model={model}
              blocked={blocked}
              onSelect={pickModel}
              onBack={effort ? () => setView('effort') : undefined}
              footer={<ModelMenuFooter {...footer} />}
            />
          )}
        </MenuContent>
      </Menu>
    </>
  )
}
