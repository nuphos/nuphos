import { Slider } from '@base-ui/react/slider'
import clsx from 'clsx'
import { ChevronRight, RotateCcw, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { effortLabel } from '../../../lib/configLabels'
import { effortStops, resolvedEffort, stopFraction } from '../../../lib/effortStops'

import {
  ACCENT_FILL,
  ACCENT_TEXT,
  FG_SECONDARY,
  FG_TERTIARY,
  HOVER_FILL,
} from './modelControlStyles'
import { HintTooltip } from './modelControlParts'

import type { SessionConfigOption } from '../../../api/session-config-types'

/** Stops sit a thumb's radius in from each end of the track. */
const KNOB = 29
const along = (fraction: number) =>
  `calc(${String(KNOB / 2)}px + (100% - ${String(KNOB)}px) * ${String(fraction)})`

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
        'group absolute top-[5.5px] flex h-[32px] w-[32px] items-center justify-center rounded-[8px] outline-none disabled:opacity-40',
        inert && 'cursor-default opacity-40',
        className,
      )}
    >
      <span
        className={clsx(
          'flex h-[26px] w-[26px] items-center justify-center rounded-[7px] group-focus-visible:bg-[rgba(var(--color-text-base),0.08)]',
          !disabled && !inert && HOVER_FILL,
        )}
      >
        {children}
      </span>
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
  /** A change is being saved; the slider stays usable and sends its last stop. */
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

  // Drop a draft once the runtime reports any change, or once a save ends
  // either way, so a failed change never lingers on the slider.
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
  const resetLevel =
    resetValue && stops.find((stop) => stop.value === resolvedEffort(effort.options, resetValue))
  const resetHint = !resetValue
    ? 'This agent reports no default effort'
    : resetValue === effort.currentValue
      ? 'Already at the default effort'
      : resetLevel
        ? `Reset to default (${effortLabel(resetLevel)})`
        : 'Reset to default'

  return (
    <div className="relative px-[13.5px] pb-[13.5px] pt-[11px]">
      {fast && (
        <IconButton
          label={fastOn ? 'Turn off fast mode' : 'Turn on fast mode'}
          pressed={fastOn}
          disabled={blocked || saving}
          onClick={() => onSelect(fast.id, fastOn ? 'off' : 'on')}
          className={clsx('left-[5.5px]', fastOn ? ACCENT_TEXT : FG_TERTIARY)}
        >
          <Zap size={16} strokeWidth={1.6} fill={fastOn ? 'currentColor' : 'none'} />
        </IconButton>
      )}
      <HintTooltip label={resetHint} side="top">
        <IconButton
          label={resetHint}
          inert={blocked || saving || !resetValue || resetValue === effort.currentValue}
          onClick={() => resetValue && onSelect(effort.id, resetValue)}
          className={clsx('right-[5.5px]', FG_TERTIARY)}
        >
          <RotateCcw size={16} strokeWidth={1.6} />
        </IconButton>
      </HintTooltip>
      <div className="flex flex-col items-center">
        <span className={clsx('text-[14px] font-medium leading-[21.5px]', ACCENT_TEXT)}>
          {current ? effortLabel(current) : 'Default'}
        </span>
        <button
          type="button"
          aria-label="Select model"
          disabled={!onOpenModels}
          onClick={onOpenModels}
          className={clsx(
            'flex max-w-full items-center gap-[2px] rounded-[6px] px-[4px] text-[12.5px] leading-[18px] outline-none focus-visible:bg-[rgba(var(--color-text-base),0.08)]',
            FG_SECONDARY,
            onOpenModels && HOVER_FILL,
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
        disabled={blocked || stops.length < 2}
        onValueChange={(value) => setDraft({ index: value, from: effort.currentValue })}
        onValueCommitted={(value) => {
          const stop = stops[value]

          clearTimeout(pending.current)
          // Arrow keys commit on every press; send only where they come to rest.
          pending.current = setTimeout(() => {
            if (stop && stop.value !== effort.currentValue) onSelect(effort.id, stop.value)
          }, 350)
        }}
        className="mt-[15.5px] data-[disabled]:opacity-60"
      >
        <Slider.Control className="relative h-[26px] cursor-pointer touch-none select-none">
          <Slider.Track className="relative h-full w-full rounded-full bg-[rgba(var(--color-text-base),0.1)] shadow-[inset_0_0_0_0.5px_rgba(var(--color-text-base),0.12)]">
            {index >= 0 && (
              <span
                className={clsx('absolute inset-y-0 left-0 rounded-l-full', ACCENT_FILL)}
                style={{ width: along(fraction) }}
              />
            )}
            {stops.map((stop, stopIndex) => (
              <span
                key={stop.value}
                aria-hidden
                className={clsx(
                  'absolute top-1/2 h-[4px] w-[4px] -translate-x-1/2 -translate-y-1/2 rounded-full',
                  stopIndex <= index ? 'bg-white/30' : 'bg-[rgba(var(--color-text-base),0.3)]',
                )}
                style={{ left: along(stopFraction(stops.length, stopIndex)) }}
              />
            ))}
            <Slider.Thumb
              inputRef={sliderRef}
              getAriaValueText={() => (current ? effortLabel(current) : 'Default')}
              className={clsx(
                'h-[29px] w-[29px] rounded-full border-[0.5px] border-black/10 bg-white shadow-[0_0_2px_rgba(0,0,0,0.1)] outline-none',
                index < 0 && 'opacity-0',
              )}
            />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </div>
  )
}
