import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import clsx from 'clsx'
import { ArrowUpRight, Check, Lock } from 'lucide-react'

import { sizeGridColumns } from './boxCreatePresentation'

import type { boxSizeChoices } from './boxPresentation'

type Choice = ReturnType<typeof boxSizeChoices>[number]
type Tone = 'selected' | 'idle' | 'locked'

const SLAB_FILL: Record<Tone, string> = {
  selected: 'fill-zViolet-500',
  idle: 'fill-zViolet-400/70',
  locked: 'fill-zGray-600',
}

/** Three stacked slabs, filled from the bottom by tier: one for Small, two for Medium, three for Large. */
function SizeGlyph({ tier, tone }: { tier: number; tone: Tone }) {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
      {[0, 1, 2].map((slab) => {
        const filled = slab <= tier

        return (
          <rect
            key={slab}
            x={4}
            y={22 - slab * 8}
            width={24}
            height={6}
            rx={2}
            className={clsx(
              'transition-colors',
              filled ? SLAB_FILL[tone] : 'fill-transparent stroke-zGray-700',
            )}
            strokeWidth={filled ? 0 : 1.25}
          />
        )
      })}
    </svg>
  )
}

function ChoiceText({ choice }: { choice: Choice }) {
  return (
    <>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-main">{choice.name}</span>
        <span className="mt-0.5 block text-[11.5px] tabular-nums text-secondary">
          {choice.spec}
        </span>
      </span>
      <span className="text-[11.5px] leading-4 text-tertiary">
        {choice.use}
        <br />
        {choice.sessions}
      </span>
    </>
  )
}

// Indexed by sizeGridColumns less one; literal so Tailwind keeps them.
const COLUMNS = ['grid-cols-1', 'grid-cols-2', 'grid-cols-3'] as const

const CARD =
  'relative flex flex-col items-start gap-2 rounded-xl border px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2'

/**
 * The sizes a new Box can have, side by side, each with its capacity drawn. A size the plan's
 * vCPU left cannot fit is locked: picking it opens the plans instead of selecting it.
 */
export function BoxSizePicker({
  choices,
  value,
  left,
  disabled,
  onChange,
  onUpgrade,
}: {
  choices: Choice[]
  value: number | undefined
  /** The plan's vCPU left; null when unknown or unlimited, which locks nothing. */
  left: number | null
  disabled: boolean
  onChange: (vcpus: number) => void
  onUpgrade: (choice: Choice) => void
}) {
  const locked = (choice: Choice) => left !== null && choice.vcpus > left

  return (
    // Rows share one height, so a wrapped card matches the row above.
    <div className={clsx('grid auto-rows-fr gap-2', COLUMNS[sizeGridColumns(choices.length) - 1])}>
      <RadioGroup
        value={String(value)}
        onValueChange={(next: string) => onChange(Number(next))}
        disabled={disabled}
        aria-label="Size"
        className="contents"
      >
        {choices
          .filter((choice) => !locked(choice))
          .map((choice) => {
            const selected = choice.vcpus === value

            return (
              <Radio.Root
                key={choice.vcpus}
                value={String(choice.vcpus)}
                aria-label={`${choice.name}, ${choice.spec}`}
                className={clsx(
                  CARD,
                  'focus-visible:ring-zViolet-accent',
                  selected
                    ? 'border-zViolet-accent bg-zViolet-accent/10'
                    : 'border-zGray-800 bg-zGray-900 hover:border-zGray-700',
                )}
              >
                <SizeGlyph tier={choice.tier} tone={selected ? 'selected' : 'idle'} />
                <ChoiceText choice={choice} />
                <Radio.Indicator
                  keepMounted
                  className={clsx(
                    'absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full',
                    selected ? 'bg-zViolet-accent text-white' : 'border border-zGray-700',
                  )}
                >
                  {selected && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
                </Radio.Indicator>
              </Radio.Root>
            )
          })}
      </RadioGroup>
      {choices.filter(locked).map((choice) => (
        <button
          key={choice.vcpus}
          type="button"
          disabled={disabled}
          aria-label={`${choice.name}, ${choice.spec}. Needs a bigger plan; choose a plan`}
          onClick={() => onUpgrade(choice)}
          className={clsx(
            CARD,
            'group border-dashed border-zGray-700 bg-transparent hover:border-amber-500/60 focus-visible:ring-amber-500/60',
          )}
        >
          <span className="flex flex-col items-start gap-2 opacity-55">
            <SizeGlyph tier={choice.tier} tone="locked" />
            <ChoiceText choice={choice} />
          </span>
          <Lock
            className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-tertiary"
            aria-hidden="true"
          />
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-500 ring-1 ring-amber-500/40 transition-colors group-hover:bg-amber-500/25">
            Upgrade to unlock
            <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
          </span>
        </button>
      ))}
    </div>
  )
}
