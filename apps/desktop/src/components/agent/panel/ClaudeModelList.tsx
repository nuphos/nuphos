import { Popover } from '@base-ui/react/popover'
import clsx from 'clsx'
import { Check, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { modelChoiceLabel } from '../../../lib/configLabels'
import { concreteModelChoices } from '../../../lib/modelChoices'
import { claudeModelGroups } from '../../../lib/modelGroups'

import { focusCurrentRow, menuKeyDown } from './menuKeys'
import { FG_TERTIARY, MENU_ROW, SURFACE } from './modelControlStyles'
import { fastUnavailableReason } from './modelSelectorParts'

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
  onBack,
}: {
  model: SessionConfigOption
  fast?: SessionConfigOption
  blocked: boolean
  onSelect: (value: string) => void
  onSelectFast: (value: 'on' | 'off') => void
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
  const fastOn = fast?.currentValue === 'on'
  const fastReason = fastUnavailableReason(fast)

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
      className="flex flex-col p-[5px]"
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
      {fast && (
        <>
          <Separator />
          <button
            type="button"
            data-menu-row=""
            role="menuitemcheckbox"
            aria-checked={fastOn}
            aria-disabled={fastReason ? true : undefined}
            disabled={blocked}
            onClick={fastReason ? undefined : () => onSelectFast(fastOn ? 'off' : 'on')}
            className={clsx(
              MENU_ROW,
              'shrink-0 items-center py-[6px] pr-[9.5px]',
              fastReason && 'cursor-default hover:bg-transparent',
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="leading-[19.5px]">Fast mode</span>
              {fastReason && (
                <span className={clsx('text-[12px] leading-[16px]', FG_TERTIARY)}>
                  {fastReason.detail}
                </span>
              )}
            </span>
            {/* The app's Switch, drawn inside the row so the whole row toggles. */}
            <span
              aria-hidden
              className={clsx(
                'relative ml-[10px] inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                fastOn ? 'bg-zViolet-500' : 'bg-zGray-700',
                fastReason && 'opacity-50',
              )}
            >
              <span
                className={clsx(
                  'inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                  fastOn ? 'translate-x-[18px]' : 'translate-x-0.5',
                )}
              />
            </span>
          </button>
        </>
      )}
    </div>
  )
}
