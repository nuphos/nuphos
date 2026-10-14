import { Slider } from '@base-ui/react/slider'
import clsx from 'clsx'
import { ChevronRight, RotateCcw, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { effortLabel } from '../../../lib/configLabels'
import { effortStops, resolvedEffort, stopFraction } from '../../../lib/effortStops'
import { Tooltip } from '../../ui/tooltip'

import { fastUnavailableReason } from './modelSelectorParts'

import type { SessionConfigOption } from '../../../api/session-config-types'

/** Stops sit a thumb's radius in from each end of the track (h-7, 28px). */
const KNOB = 28
const along = (fraction: number) =>
  `calc(${String(KNOB / 2)}px + (100% - ${String(KNOB)}px) * ${String(fraction)})`
const HOVER = 'hover:bg-zGray-800/80 focus-visible:bg-zGray-800/80'

function IconButton({
  label,
  onClick,
  disabled,
  inert,
  pressed,
  className,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  /** Looks unavailable but still shows its tooltip, which says why. */
  inert?: boolean
  pressed?: boolean
  className: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      aria-disabled={inert || undefined}
      onClick={inert ? undefined : onClick}
      className={clsx(
        'flex h-7 w-7 items-center justify-center rounded-md outline-none disabled:opacity-40',
        inert ? 'cursor-default opacity-40' : !disabled && HOVER,
        className,
      )}
    >
      {children}
    </button>
  )
}

/**
 * The top of Codex's effort popover: fast toggle, the effort name over the
 * model name, reset, and a slider with one stop per level.
 */
export function ModelEffortPanel({
  effort,
  fast,
  modelName,
  resetValue,
  blocked,
  saving,
  sliderRef,
  onSelect,
  onOpenModels,
}: {
  effort: SessionConfigOption
  fast?: SessionConfigOption
  modelName: string
  resetValue?: string
  /** No changes at all, e.g. the agent is offline. */
  blocked: boolean
  /** A change is being saved; the slider and reset are disabled until it ends. */
  saving: boolean
  sliderRef?: React.Ref<HTMLInputElement>
  onSelect: (configId: string, value: string) => void
  onOpenModels?: () => void
}) {
  const stops = effortStops(effort.options)
  const running = resolvedEffort(effort.options, effort.currentValue)
  const committed = stops.findIndex((stop) => stop.value === running)
  // A draft only holds until the runtime reports a different level.
  const [draft, setDraft] = useState<{ index: number; from: string }>()
  const [wasSaving, setWasSaving] = useState(saving)

  // Drop a draft once the runtime reports any change, or once a save ends,
  // so a failed change never lingers on the slider.
  if (wasSaving !== saving) {
    setWasSaving(saving)
    if (!saving && draft) setDraft(undefined)
  }
  if (draft && draft.from !== effort.currentValue) setDraft(undefined)
  const index = draft?.from === effort.currentValue ? draft.index : committed
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(pending.current), [])
  const current = index >= 0 ? stops[index] : undefined
  const fraction = stopFraction(stops.length, index)
  const fastOn = fast?.currentValue === 'on'
  const fastReason = fastUnavailableReason(fast)
  const resetLevel =
    resetValue && stops.find((stop) => stop.value === resolvedEffort(effort.options, resetValue))
  const resetHint =
    resetValue === effort.currentValue
      ? 'Already at the default effort'
      : resetLevel
        ? `Reset to default (${effortLabel(resetLevel)})`
        : 'Reset to default'

  return (
    <div className="relative px-3 pb-3 pt-2.5">
      {fast && (
        <Tooltip
          content={fastReason?.tooltip ?? (fastOn ? 'Fast mode is on' : 'Fast mode')}
          triggerClassName="absolute left-1.5 top-1.5"
        >
          <IconButton
            label={fastReason?.tooltip ?? (fastOn ? 'Turn off fast mode' : 'Turn on fast mode')}
            pressed={fastOn}
            disabled={blocked || saving}
            inert={Boolean(fastReason)}
            onClick={() => onSelect(fast.id, fastOn ? 'off' : 'on')}
            className={fastOn ? 'text-zOrangered-400' : 'text-tertiary'}
          >
            <Zap size={16} strokeWidth={1.6} fill={fastOn ? 'currentColor' : 'none'} />
          </IconButton>
        </Tooltip>
      )}
      {/* Reset only exists where the runtime names a default level to return to. */}
      {resetValue && (
        <Tooltip content={resetHint} triggerClassName="absolute right-1.5 top-1.5">
          <IconButton
            label={resetHint}
            inert={blocked || saving || resetValue === effort.currentValue}
            onClick={() => onSelect(effort.id, resetValue)}
            className="text-tertiary"
          >
            <RotateCcw size={16} strokeWidth={1.6} />
          </IconButton>
        </Tooltip>
      )}
      <div className="flex flex-col items-center">
        <span className="text-sm font-medium text-zOrangered-400">
          {current ? effortLabel(current) : 'Default'}
        </span>
        <button
          type="button"
          aria-label="Select model"
          disabled={!onOpenModels}
          onClick={onOpenModels}
          className={clsx(
            'flex max-w-full items-center gap-0.5 rounded-md px-1 text-xs leading-5 text-secondary outline-none',
            onOpenModels && HOVER,
          )}
        >
          <span className="truncate">{modelName}</span>
          {onOpenModels && <ChevronRight size={12} strokeWidth={2} className="shrink-0" />}
        </button>
      </div>
      <Slider.Root
        aria-label="Effort"
        value={Math.max(index, 0)}
        min={0}
        max={Math.max(stops.length - 1, 1)}
        step={1}
        thumbAlignment="edge"
        // A session ignores writes while one is saving, so hold the slider still.
        disabled={blocked || saving || stops.length < 2}
        onValueChange={(value) => setDraft({ index: value, from: effort.currentValue })}
        onValueCommitted={(value) => {
          const stop = stops[value]

          clearTimeout(pending.current)
          // Arrow keys commit on every press; send only where they come to rest.
          pending.current = setTimeout(() => {
            if (stop && stop.value !== effort.currentValue) onSelect(effort.id, stop.value)
          }, 350)
        }}
        className="mt-4 data-[disabled]:opacity-60"
      >
        <Slider.Control className="relative h-7 cursor-pointer touch-none select-none">
          <Slider.Track className="relative h-full w-full rounded-full bg-zGray-800">
            {index >= 0 && (
              <span
                className="absolute inset-y-0 left-0 rounded-l-full bg-zOrangered-400"
                style={{ width: along(fraction) }}
              />
            )}
            {stops.map((stop, stopIndex) => (
              <span
                key={stop.value}
                aria-hidden
                className={clsx(
                  'absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full',
                  stopIndex <= index ? 'bg-white/40' : 'bg-zGray-600',
                )}
                style={{ left: along(stopFraction(stops.length, stopIndex)) }}
              />
            ))}
            <Slider.Thumb
              inputRef={sliderRef}
              getAriaValueText={() => (current ? effortLabel(current) : 'Default')}
              className={clsx(
                'h-7 w-7 rounded-full border border-black/10 bg-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-zOrangered-400/60',
                index < 0 && 'opacity-0',
              )}
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </div>
  )
}
