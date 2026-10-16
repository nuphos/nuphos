import clsx from 'clsx'
import { Check } from 'lucide-react'

import { modelChoiceLabel } from '../../../lib/configLabels'
import { concreteModelChoices, isDefaultModel } from '../../../lib/modelChoices'

import { HintTooltip } from './modelControlParts'
import { FG_TERTIARY, MENU_ROW as ROW } from './modelControlStyles'

import type { SessionConfigOption } from '../../../api/session-config-types'

/**
 * Codex's "Select model" list: a Default row, then each model with a check on
 * the current one and its description beside the row on hover.
 */
export function ModelListPanel({
  model,
  offerDefault,
  blocked,
  onSelect,
}: {
  model: SessionConfigOption
  /** Whether the runtime can go back to its own default model. */
  offerDefault: boolean
  blocked: boolean
  onSelect: (value: string) => void
}) {
  const inherited = model.options.find((choice) => isDefaultModel(choice.value, choice.name))
  const { choices, current } = concreteModelChoices(
    model.options.map((choice) => ({ ...choice, id: choice.value })),
    model.currentValue,
  )
  const onDefault = model.currentValue === inherited?.value

  return (
    <div className="flex max-h-[min(360px,var(--available-height))] flex-col overflow-y-auto px-[5px] pb-[3.5px] pt-[5px]">
      <p className={clsx('px-[9px] pb-[5px] pt-[6px] text-[13px] leading-[18px]', FG_TERTIARY)}>
        Select model
      </p>
      {(inherited || offerDefault) && (
        <button
          type="button"
          role="menuitemradio"
          aria-checked={onDefault}
          disabled={blocked}
          onClick={() => onSelect(inherited?.value ?? 'default')}
          className={clsx(ROW, 'flex-col items-start pb-[6.5px] pt-[5.5px]')}
        >
          <span className="flex w-full items-center leading-[20px]">
            <span className="flex-1">Default</span>
            {onDefault && <Check size={14} strokeWidth={2} className={FG_TERTIARY} />}
          </span>
          <span className={clsx('text-[12px] leading-[16px]', FG_TERTIARY)}>
            {inherited?.description || 'Recommended set of models'}
          </span>
        </button>
      )}
      {choices.map((choice) => {
        const row = (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!onDefault && choice.id === current}
            disabled={blocked}
            onClick={() => onSelect(choice.value)}
            className={clsx(ROW, 'h-[31.5px] shrink-0 items-center pr-[9.5px]')}
          >
            <span className="min-w-0 flex-1 truncate">{modelChoiceLabel(choice)}</span>
            {!onDefault && choice.id === current && (
              <Check
                size={14}
                strokeWidth={2}
                className="shrink-0 text-[rgba(var(--color-text-base),0.7)]"
              />
            )}
          </button>
        )

        return choice.description ? (
          <HintTooltip key={choice.id} label={choice.description} side="right" sideOffset={18}>
            {row}
          </HintTooltip>
        ) : (
          <div key={choice.id}>{row}</div>
        )
      })}
    </div>
  )
}
