import clsx from 'clsx'
import { useRef } from 'react'

import { t } from '../../i18n'
import {
  BOT_AVATAR_BACKGROUNDS,
  botAvatarBackgroundColor,
  botAvatarBackgroundLabel,
} from '../../lib/botAvatarBackgrounds'

import type { BotAvatarBackground } from '../../lib/botAvatarBackgrounds'
import type React from 'react'

/** The tint a Bot's character sits on, as one radio group in the character grid's tiles. */
export function AvatarBackgroundPicker({
  value,
  onChange,
}: {
  value: BotAvatarBackground
  onChange: (background: BotAvatarBackground) => void
}) {
  const tiles = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.max(BOT_AVATAR_BACKGROUNDS.indexOf(value), 0)

  function move(event: React.KeyboardEvent) {
    const last = BOT_AVATAR_BACKGROUNDS.length - 1
    const steps: Partial<Record<string, number>> = {
      ArrowRight: current + 1,
      ArrowDown: current + 1,
      ArrowLeft: current - 1,
      ArrowUp: current - 1,
      Home: 0,
      End: last,
    }
    const next = steps[event.key]

    if (next === undefined) return
    event.preventDefault()
    const index = Math.min(Math.max(next, 0), last)

    onChange(BOT_AVATAR_BACKGROUNDS[index])
    tiles.current[index]?.focus()
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-[12px] text-tertiary">{t('Background')}</span>
      <div
        role="radiogroup"
        aria-label={t('Background')}
        onKeyDown={move}
        className="flex justify-center gap-1"
      >
        {BOT_AVATAR_BACKGROUNDS.map((name, index) => {
          const selected = index === current
          const color = botAvatarBackgroundColor(name)

          return (
            <button
              key={name}
              ref={(node) => {
                tiles.current[index] = node
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={botAvatarBackgroundLabel(name)}
              title={botAvatarBackgroundLabel(name)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(name)}
              className={clsx(
                'flex size-10 items-center justify-center rounded-lg outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-line-focus',
                selected ? 'bg-state-selected ring-1 ring-line-focus' : 'hover:bg-state-hover',
              )}
            >
              <span
                className={clsx(
                  'size-6 rounded-full',
                  !color && 'border border-dashed border-line-control',
                )}
                style={color ? { background: color } : undefined}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
