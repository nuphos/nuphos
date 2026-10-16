import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { Check, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { modelChoiceLabel } from '../../../lib/configLabels'
import { concreteModelChoices } from '../../../lib/modelChoices'
import { claudeModelGroups } from '../../../lib/modelGroups'

import { focusCurrentRow, menuKeyDown } from './menuKeys'
import { HintTooltip } from './modelControlParts'
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
  const row = (
    <button
      type="button"
      data-menu-row=""
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

  // The description sits beside the row, as in Codex's list.
  return choice.description ? (
    <HintTooltip label={choice.description} side="right" sideOffset={17.6} description>
      {row}
    </HintTooltip>
  ) : (
    row
  )
}

/**
 * Claude chats' model list, in the Codex list's layout: the newest model of
 * each family numbered 1–4 for the keyboard, and older ones under "More models".
 */
export function ClaudeModelList({
  model,
  blocked,
  onSelect,
  onBack,
}: {
  model: SessionConfigOption
  blocked: boolean
  onSelect: (value: string) => void
  /** Back to the effort view. */
  onBack?: () => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const olderRef = useRef<HTMLDivElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => focusCurrentRow(listRef.current), [])
  const { choices, current } = concreteModelChoices(
    model.options.map((choice) => ({ ...choice, id: choice.value })),
    model.currentValue,
  )
  const { latest, older } = claudeModelGroups(choices, modelChoiceLabel)

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
    <div
      ref={listRef}
      className="flex max-h-[min(360px,var(--available-height))] flex-col overflow-y-auto px-[5px] pb-[3.5px] pt-[5px]"
      onKeyDown={(event) =>
        menuKeyDown(event, {
          onBack,
          onForward: (row) => {
            if (!moreRef.current?.isSameNode(row)) return false
            setMoreOpen(true)

            return true
          },
        })
      }
    >
      <p className={clsx('px-[9px] pb-[5px] pt-[6px] text-[13px] leading-[18px]', FG_TERTIARY)}>
        Select model
      </p>
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
          <Popover.Root
            open={moreOpen}
            onOpenChange={setMoreOpen}
            onOpenChangeComplete={(open) => {
              if (open && olderRef.current?.contains(document.activeElement) === false)
                focusCurrentRow(olderRef.current)
            }}
          >
            <Popover.Trigger
              ref={moreRef}
              data-menu-row=""
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
                // Keep the first row level with "More models"; when there is no
                // room below, line the last row up with it instead of sliding over
                // the composer.
                collisionAvoidance={{ side: 'flip', align: 'flip', fallbackAxisSide: 'none' }}
                className="z-[1001]"
              >
                <Popover.Popup
                  ref={olderRef}
                  initialFocus={false}
                  // ← returns to "More models".
                  onKeyDown={(event) =>
                    menuKeyDown(event, {
                      onBack: () => {
                        setMoreOpen(false)
                        moreRef.current?.focus()
                      },
                    })
                  }
                  className={clsx(
                    SURFACE,
                    'model-picker-enter flex max-h-[var(--available-height)] w-[220px] flex-col overflow-y-auto rounded-[16px] p-[5px] outline-none',
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
    </div>
  )
}
