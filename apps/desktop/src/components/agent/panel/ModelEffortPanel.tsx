import { Slider } from '@base-ui/react/slider'
import clsx from 'clsx'
import { Rocket, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'

import { t } from '../../../i18n'
import { effortLabel } from '../../../lib/configLabels'
import { effortStops, resolvedEffort, stopFraction } from '../../../lib/effortStops'
import { Tooltip } from '../../ui/tooltip'

import { effortCommit } from './effortCommit'
import { fastUnavailableReason } from './modelSelectorParts'

import type { SessionConfigOption } from '../../../api/session-config-types'

/** Stops sit a thumb's radius in from each end of the track (h-7, 28px). */
const KNOB = 28
const along = (fraction: number) =>
  `calc(${String(KNOB / 2)}px + (100% - ${String(KNOB)}px) * ${String(fraction)})`
const HOVER = 'hover:bg-state-hover focus-visible:bg-state-hover'

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
 * The effort controls pinned under the model list: the level by name, fast
 * toggles, and a slider with one stop per level. A runtime without fast leaves
 * the toggles out. Keys stay here, so ←/→ move the slider, not the menu.
 */
export function ModelEffortPanel({
  effort,
  fast,
  blocked,
  saving,
  sliderRef,
  onSelect,
}: {
  effort?: SessionConfigOption
  fast?: SessionConfigOption
  /** No changes at all, e.g. the agent is offline. */
  blocked: boolean
  /** A change is being saved; the slider is disabled until it ends. */
  saving: boolean
  sliderRef?: React.Ref<HTMLInputElement>
  onSelect: (configId: string, value: string) => void
}) {
  const choices = effort?.options ?? []
  const currentValue = effort?.currentValue ?? ''
  const stops = effortStops(choices)
  const running = resolvedEffort(choices, currentValue)
  const committed = stops.findIndex((stop) => stop.value === running)
  // A draft only holds until the runtime reports a different level.
  const [draft, setDraft] = useState<{ index: number; from: string }>()
  const [wasSaving, setWasSaving] = useState(saving)
  const [commit] = useState(effortCommit)

  useEffect(() => () => commit.flush(), [commit])

  // Drop a draft once the runtime reports any change, or once a save ends,
  // so a failed change never lingers on the slider.
  if (wasSaving !== saving) {
    setWasSaving(saving)
    if (!saving && draft) setDraft(undefined)
  }
  if (draft && draft.from !== currentValue) setDraft(undefined)
  const index = draft?.from === currentValue ? draft.index : committed
  const current = index >= 0 ? stops[index] : undefined
  const fraction = stopFraction(stops.length, index)
  const fastOn = fast?.currentValue === 'on'
  const fastReason = fastUnavailableReason(fast)
  const ultrafastOn = fast?.currentValue === 'ultrafast'
  // Codex offers Ultrafast as a separate tier beside Fast; Claude has only Fast.
  const offersFast = fast?.options.some((option) => option.value === 'on')
  const offersUltrafast = fast?.options.some((option) => option.value === 'ultrafast')

  return (
    <div
      className="px-3 pb-3 pt-1.5"
      onKeyDown={(event) => {
        // Escape and Tab still close the menu; the rest belong to the slider and toggles.
        if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation()
      }}
    >
      <div className="flex h-7 items-center gap-1.5">
        {effort && (
          <>
            <span className="text-xs text-tertiary">{t('Effort')}</span>
            <span className="text-sm font-medium text-status-attention">
              {current && effortLabel(current)}
            </span>
          </>
        )}
        <span className="flex-1" />
        {offersFast && (
          <Tooltip
            content={fastReason?.tooltip ?? (fastOn ? t('Fast mode is on') : t('Fast mode'))}
          >
            <IconButton
              label={
                fastReason?.tooltip ?? (fastOn ? t('Turn off fast mode') : t('Turn on fast mode'))
              }
              pressed={fastOn}
              disabled={blocked || saving}
              inert={Boolean(fastReason)}
              onClick={() => fast && onSelect(fast.id, fastOn ? 'off' : 'on')}
              className={fastOn ? 'text-status-attention' : 'text-tertiary'}
            >
              <Zap size={16} strokeWidth={1.6} fill={fastOn ? 'currentColor' : 'none'} />
            </IconButton>
          </Tooltip>
        )}
        {offersUltrafast && (
          <Tooltip content={ultrafastOn ? t('Ultrafast mode is on') : t('Ultrafast mode')}>
            <IconButton
              label={ultrafastOn ? t('Turn off Ultrafast mode') : t('Turn on Ultrafast mode')}
              pressed={ultrafastOn}
              disabled={blocked || saving}
              onClick={() => fast && onSelect(fast.id, ultrafastOn ? 'off' : 'ultrafast')}
              className={ultrafastOn ? 'text-status-attention' : 'text-tertiary'}
            >
              <Rocket size={16} strokeWidth={1.6} fill={ultrafastOn ? 'currentColor' : 'none'} />
            </IconButton>
          </Tooltip>
        )}
      </div>
      {effort && (
        <Slider.Root
          aria-label={t('Effort')}
          value={Math.max(index, 0)}
          min={0}
          max={Math.max(stops.length - 1, 1)}
          step={1}
          thumbAlignment="edge"
          // A session ignores writes while one is saving, so hold the slider still.
          disabled={blocked || saving || stops.length < 2}
          onValueChange={(value) => setDraft({ index: value, from: currentValue })}
          onValueCommitted={(value) => {
            const stop = stops[value]

            commit.schedule(
              stop && stop.value !== currentValue
                ? () => onSelect(effort.id, stop.value)
                : undefined,
            )
          }}
          className="mt-1.5 data-[disabled]:opacity-60"
        >
          <Slider.Control className="relative h-7 cursor-pointer touch-none select-none">
            <Slider.Track className="relative h-full w-full rounded-full bg-surface-sunken">
              {index >= 0 && (
                <span
                  className="absolute inset-y-0 left-0 rounded-l-full bg-status-attention"
                  style={{ width: along(fraction) }}
                />
              )}
              {stops.map((stop, stopIndex) => (
                <span
                  key={stop.value}
                  aria-hidden
                  className={clsx(
                    'absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full',
                    stopIndex <= index ? 'bg-white/40' : 'bg-line-control',
                  )}
                  style={{ left: along(stopFraction(stops.length, stopIndex)) }}
                />
              ))}
              <Slider.Thumb
                inputRef={sliderRef}
                getAriaValueText={() => (current ? effortLabel(current) : '')}
                className={clsx(
                  'h-7 w-7 rounded-full border border-black/10 bg-white shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-status-attention/60',
                  index < 0 && 'opacity-0',
                )}
              />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
      )}
    </div>
  )
}
