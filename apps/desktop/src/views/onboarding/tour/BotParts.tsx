import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { LoaderCircle } from 'lucide-react'

import { AgentProviderIcon } from '../../../components/agent/panel/icons'
import { t } from '../../../i18n'

import type { AgentProvider } from '../../../types/runtime'
import type { KeyboardEvent } from 'react'

export type Side = 'here' | 'box'

const pop = { type: 'spring', stiffness: 420, damping: 22 } as const
const spring = { type: 'spring', stiffness: 260, damping: 26 } as const

/**
 * The two computers' names, under each machine, as a choice of where Frida works: the chosen
 * one sits in a pill, the other is a button that moves her there. Arrow keys move between them,
 * as a radio group does. `nudge` makes the other name glow once. Laid out as the machines are.
 */
export function LabelPicker({
  side,
  names,
  disabled,
  nudge,
  reduce,
  onPick,
}: {
  side: Side
  names: Record<Side, string>
  disabled: boolean
  nudge: boolean
  reduce: boolean
  onPick: (side: Side) => void
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const next: Side = side === 'box' ? 'here' : 'box'

    onPick(next)
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-side="${next}"]`)?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('Where Frida works')}
      onKeyDown={onKeyDown}
      className="pointer-events-none absolute inset-x-0 top-[250px] flex justify-center gap-[100px]"
    >
      {(['here', 'box'] as const).map((option) => {
        const checked = option === side

        return (
          <div key={option} className="relative h-[54px] w-[175px]">
            {checked && (
              <motion.span
                aria-hidden
                layoutId="tour-label-pick"
                transition={reduce ? { duration: 0 } : spring}
                className="tour-label-picked absolute inset-x-3 inset-y-0 -z-10 rounded-xl bg-surface-raised"
              />
            )}
            <button
              type="button"
              role="radio"
              data-side={option}
              aria-checked={checked}
              aria-label={names[option]}
              tabIndex={checked ? 0 : -1}
              disabled={disabled && !checked}
              onClick={() => !checked && onPick(option)}
              className={clsx(
                'group pointer-events-auto absolute inset-x-3 inset-y-0 rounded-xl outline-none',
                'focus-visible:ring-2 focus-visible:ring-line-focus',
                !checked && 'enabled:cursor-pointer',
              )}
            >
              {/* Behind the name, so hovering never dims it. */}
              <span
                className={clsx(
                  'absolute inset-0 -z-10 rounded-xl',
                  'transition-colors duration-[var(--duration-medium)] ease-[var(--ease-in-out)]',
                  !checked && 'group-enabled:group-hover:bg-state-hover',
                  !checked && nudge && 'tour-nudge',
                )}
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** Her face, with the runtime she works with in the corner; a spinner while it changes. */
export function Face({
  switching,
  provider,
  reduce,
}: {
  switching: boolean
  provider: AgentProvider
  reduce: boolean
}) {
  return (
    <span className="relative size-8 shrink-0">
      <img
        src="/bot-avatars/09-frida.svg"
        alt=""
        className="size-8 rounded-full bg-surface-sunken object-contain"
      />
      <span className="absolute -bottom-1 -right-1 grid size-[18px] place-items-center rounded-full border border-line-control bg-surface-raised">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={switching ? 'switching' : provider}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.15 } }}
            transition={reduce ? { duration: 0 } : pop}
            className="grid place-items-center"
          >
            {switching ? (
              <LoaderCircle className="size-2.5 animate-spin text-tertiary motion-reduce:animate-none" />
            ) : (
              <AgentProviderIcon provider={provider} className="size-2.5" />
            )}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  )
}
