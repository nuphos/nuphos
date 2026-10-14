import { Slider } from '@base-ui/react/slider'
import clsx from 'clsx'
import { ChevronRight, RotateCcw, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { effortLabel } from '../../../lib/configLabels'
import { effortStops, stopFraction } from '../../../lib/effortStops'

import {
  ACCENT_FILL,
  ACCENT_TEXT,
  FG_SECONDARY,
  FG_TERTIARY,
  HOVER_FILL,
} from './modelControlStyles'

import type { SessionConfigOption } from '../../../api/session-config-types'

/** Stops sit a thumb's radius in from each end of the track. */
const KNOB = 29
const along = (fraction: number) =>
  `calc(${String(KNOB / 2)}px + (100% - ${String(KNOB)}px) * ${String(fraction)})`

function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  className,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
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
      onClick={onClick}
      className={clsx(
        'group absolute top-[5.5px] flex h-[32px] w-[32px] items-center justify-center rounded-[8px] outline-none disabled:opacity-40',
        className,
      )}
    >
      <span
        className={clsx(
          'flex h-[26px] w-[26px] items-center justify-center rounded-[7px] group-focus-visible:bg-[rgba(var(--color-text-base),0.08)]',
          !disabled && HOVER_FILL,
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
  const committed = stops.findIndex((stop) => stop.value === effort.currentValue)
  // A draft only holds until the runtime reports a different level.
  const [draft, setDraft] = useState<{ index: number; from: string }>()
  const index = draft?.from === effort.currentValue ? draft.index : committed
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(pending.current), [])
  const current = index >= 0 ? stops[index] : undefined
  const fraction = stopFraction(stops.length, index)
  const fastOn = fast?.currentValue === 'on'

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
      <IconButton
        label="Reset to default"
        disabled={blocked || saving || !resetValue || resetValue === effort.currentValue}
        onClick={() => resetValue && onSelect(effort.id, resetValue)}
        className={clsx('right-[5.5px]', FG_TERTIARY)}
      >
        <RotateCcw size={16} strokeWidth={1.6} />
      </IconButton>
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
