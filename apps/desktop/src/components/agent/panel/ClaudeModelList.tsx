import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { Check, ChevronRight } from 'lucide-react'
import { useEffect } from 'react'

import { modelChoiceLabel } from '../../../lib/configLabels'
import { concreteModelChoices } from '../../../lib/modelChoices'
import { claudeModelGroups } from '../../../lib/modelGroups'
import { Switch } from '../../ui/Switch'

import { FG_TERTIARY, MENU_ROW, SURFACE } from './modelControlStyles'

import type { SessionConfigOption } from '../../../api/session-config-types'

type Choice = SessionConfigOption['options'][number] & { id: string }

const Separator = () => (
  <div role="separator" className="mx-[9px] my-[4px] h-px bg-[rgba(var(--color-text-base),0.08)]" />
)

function ModelRow({
  choice,
  current,
  hint,
  blocked,
  onSelect,
}: {
  choice: Choice
  current: boolean
  hint?: string
  blocked: boolean
  onSelect: (value: string) => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={current}
      disabled={blocked}
      onClick={() => onSelect(choice.value)}
      className={clsx(MENU_ROW, 'h-[31.5px] shrink-0 items-center pr-[9.5px]')}
    >
      <span className="min-w-0 flex-1 truncate">{modelChoiceLabel(choice)}</span>
      {current ? (
        <Check
          size={14}
          strokeWidth={2}
          className="shrink-0 text-[rgba(var(--color-text-base),0.7)]"
        />
      ) : (
        hint && (
          <span className={clsx('w-[14px] text-center text-[12px]', FG_TERTIARY)}>{hint}</span>
        )
      )}
    </button>
  )
}

/**
 * Claude's model menu: the newest model of each family, numbered 1–4 for the
 * keyboard, older ones under "More models", then Fast mode.
 */
export function ClaudeModelList({
  model,
  fast,
  blocked,
  onSelect,
  onSelectFast,
}: {
  model: SessionConfigOption
  fast?: SessionConfigOption
  blocked: boolean
  onSelect: (value: string) => void
  onSelectFast: (value: 'on' | 'off') => void
}) {
  const { choices, current } = concreteModelChoices(
    model.options.map((choice) => ({ ...choice, id: choice.value })),
    model.currentValue,
  )
  const { latest, older } = claudeModelGroups(choices, modelChoiceLabel)
  const fastOn = fast?.currentValue === 'on'

  // Number keys pick a model while this menu is open, as in Claude.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (blocked || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null

      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      const choice = latest[Number(event.key) - 1]

      if (!/^[1-9]$/.test(event.key) || !choice) return
      event.preventDefault()
      onSelect(choice.value)
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [blocked, latest, onSelect])

  return (
    <div className="flex flex-col p-[5px]">
      {latest.map((choice, index) => (
        <ModelRow
          key={choice.id}
          choice={choice}
          current={choice.id === current}
          hint={String(index + 1)}
          blocked={blocked}
          onSelect={onSelect}
        />
      ))}
      {older.length > 0 && (
        <>
          <Separator />
          <Popover.Root>
            <Popover.Trigger
              openOnHover
              delay={80}
              className={clsx(
                MENU_ROW,
                'h-[31.5px] items-center pr-[9.5px] data-[popup-open]:bg-[rgba(var(--color-text-base),0.08)]',
              )}
            >
              <span className="flex-1">More models</span>
              {older.some((choice) => choice.id === current) && (
                <Check
                  size={14}
                  strokeWidth={2}
                  className="mr-[6px] text-[rgba(var(--color-text-base),0.7)]"
                />
              )}
              <ChevronRight size={14} strokeWidth={1.8} className={FG_TERTIARY} />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner
                side="right"
                align="start"
                sideOffset={10}
                alignOffset={-5}
                className="z-[1001]"
              >
                <Popover.Popup
                  initialFocus={false}
                  className={clsx(
                    SURFACE,
                    't-dropdown is-open flex max-h-[var(--available-height)] w-[220px] flex-col overflow-y-auto rounded-[16px] p-[5px] outline-none',
                  )}
                >
                  {older.map((choice) => (
                    <ModelRow
                      key={choice.id}
                      choice={choice}
                      current={choice.id === current}
                      blocked={blocked}
                      onSelect={onSelect}
                    />
                  ))}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </>
      )}
      {fast && (
        <>
          <Separator />
          <div
            className={clsx(MENU_ROW, 'h-[31.5px] items-center pr-[9.5px] hover:bg-transparent')}
          >
            <span className="flex-1">Fast mode</span>
            <Switch
              checked={fastOn}
              disabled={blocked}
              label="Fast mode"
              onChange={(on) => onSelectFast(on ? 'on' : 'off')}
            />
          </div>
        </>
      )}
    </div>
  )
}
