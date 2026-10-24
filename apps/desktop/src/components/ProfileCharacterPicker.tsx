import clsx from 'clsx'
import { Check } from 'lucide-react'
import { useRef } from 'react'

import { ProfileCharacterImage } from './ProfileCharacterImage'
import {
  PROFILE_HAIRSTYLES,
  PROFILE_LOOKS,
  characterForLook,
  hairstyleLabel,
  profileLook,
  profileLookLabel,
} from '../lib/profileCharacter'

import type { ProfileLook } from '../lib/profileCharacter'
import type { ProfileCharacter } from '../types'
import type React from 'react'

/** Boy, Girl, then None: the person's own photo, which is also what shows before a pick. */
const LOOK_OPTIONS: readonly (ProfileLook | 'none')[] = [...PROFILE_LOOKS, 'none']

const STEPS: Partial<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
}

/** The radio the arrow key lands on, wrapping at both ends; undefined for other keys. */
function arrowTarget(event: React.KeyboardEvent, count: number, index: number): number | undefined {
  const step = STEPS[event.key]

  if (step === undefined) return undefined
  event.preventDefault()

  return (index + step + count) % count
}

/**
 * Two steps: Boy, Girl or None, then one of that look's three hairstyles. None (the
 * person's own photo) is the default, and then only step 1 shows. Switching look keeps the hairstyle slot, so the ring
 * always shows someone. Hover or arrow keys preview a hairstyle in the ring;
 * Escape or leaving the row puts the saved one back. The buttons stay enabled
 * while a pick saves, so keyboard focus is never dropped; the card ignores
 * picks until the save finishes.
 */
export function ProfileCharacterPicker({
  value,
  onPick,
  onPreview,
}: {
  value: ProfileCharacter | undefined
  /** A character, or null for none: the person's own photo. */
  onPick: (character: ProfileCharacter | null) => void
  onPreview: (character: ProfileCharacter | null) => void
}) {
  const look = value ? profileLook(value) : undefined
  const looks = useRef<(HTMLButtonElement | null)[]>([])
  const tiles = useRef<(HTMLButtonElement | null)[]>([])

  function pickLook(next: ProfileLook | 'none') {
    if (next === 'none') {
      if (value) onPick(null)
    } else if (next !== look) onPick(characterForLook(next, value))
  }

  function moveLook(event: React.KeyboardEvent, index: number) {
    const next = arrowTarget(event, LOOK_OPTIONS.length, index)

    if (next === undefined) return
    looks.current[next]?.focus()
    pickLook(LOOK_OPTIONS[next])
  }

  function moveHair(
    event: React.KeyboardEvent,
    styles: readonly ProfileCharacter[],
    index: number,
  ) {
    if (event.key === 'Escape') {
      onPreview(null)

      return
    }
    const next = arrowTarget(event, styles.length, index)

    if (next === undefined) return
    tiles.current[next]?.focus()
    onPreview(styles[next])
  }

  const styles = look ? PROFILE_HAIRSTYLES[look] : []

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3.5">
        <span className="w-14 text-[12.5px] text-tertiary">1 · You</span>
        <div
          role="radiogroup"
          aria-label="Boy, girl or none"
          className="inline-flex rounded-lg border border-zGray-800 bg-surface p-0.5"
        >
          {LOOK_OPTIONS.map((option, index) => {
            const selected = option === 'none' ? !look : option === look

            return (
              <button
                key={option}
                ref={(node) => {
                  looks.current[index] = node
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => pickLook(option)}
                onKeyDown={(event) => moveLook(event, index)}
                className={clsx(
                  'rounded-md px-3.5 py-1 text-[12.5px] transition-colors',
                  selected
                    ? 'bg-zViolet-accent/10 font-medium text-zViolet-accent'
                    : 'text-secondary hover:text-main',
                )}
              >
                {option === 'none' ? 'None' : profileLookLabel(option)}
              </button>
            )
          })}
        </div>
      </div>
      {look && (
        <div className="flex items-center gap-3.5">
          <span className="w-14 text-[12.5px] text-tertiary">2 · Hair</span>
          <div
            role="radiogroup"
            aria-label="Hairstyle"
            className="flex gap-2"
            onPointerLeave={() => onPreview(null)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) onPreview(null)
            }}
          >
            {styles.map((style, index) => {
              const selected = style === value

              return (
                <button
                  key={style}
                  ref={(node) => {
                    tiles.current[index] = node
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onPick(style)}
                  onPointerEnter={() => onPreview(style)}
                  onKeyDown={(event) => moveHair(event, styles, index)}
                  className={clsx(
                    'relative flex w-[72px] flex-col items-center gap-0.5 rounded-xl border px-1 pb-1.5 pt-1 text-[12px] transition-colors',
                    selected
                      ? 'border-zViolet-accent bg-zViolet-accent/[0.06] font-medium text-zViolet-accent'
                      : 'border-zGray-800 bg-surface text-secondary hover:border-zViolet-accent/45',
                  )}
                >
                  <ProfileCharacterImage character={style} className="h-14 w-14" />
                  {hairstyleLabel(style)}
                  {selected && (
                    <Check
                      aria-hidden
                      strokeWidth={3}
                      className="absolute right-1.5 top-1.5 h-3.5 w-3.5 rounded-full bg-zViolet-accent p-0.5 text-white"
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
