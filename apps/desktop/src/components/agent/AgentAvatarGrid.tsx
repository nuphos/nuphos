import clsx from 'clsx'
import { useRef, useState } from 'react'

import { t } from '../../i18n'
import { BOT_AVATARS, botAvatarLabel } from '../../lib/botAvatars'

import { BotAvatarImage } from './BotAvatarImage'

import type { BotAvatarFile } from '../../lib/botAvatars'
import type React from 'react'

const COLUMNS = 7

/** Every bot avatar as one radio group; arrow keys move through the grid. */
export function AgentAvatarGrid({
  value,
  onChange,
  onPreview,
}: {
  value: BotAvatarFile
  onChange: (file: BotAvatarFile) => void
  /** The avatar under the pointer, or null once it leaves the grid. */
  onPreview: (file: BotAvatarFile | null) => void
}) {
  const tiles = useRef<(HTMLButtonElement | null)[]>([])
  const [focused, setFocused] = useState(BOT_AVATARS.indexOf(value))

  function move(event: React.KeyboardEvent) {
    const last = BOT_AVATARS.length - 1
    const steps: Partial<Record<string, number>> = {
      ArrowRight: focused + 1,
      ArrowLeft: focused - 1,
      ArrowDown: focused + COLUMNS,
      ArrowUp: focused - COLUMNS,
      Home: 0,
      End: last,
    }
    const next = steps[event.key]

    if (next === undefined) return
    event.preventDefault()
    const index = Math.min(Math.max(next, 0), last)

    // Radio groups select as focus moves, so the preview follows the keys.
    setFocused(index)
    onChange(BOT_AVATARS[index])
    tiles.current[index]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('Avatar')}
      onKeyDown={move}
      onPointerLeave={() => onPreview(null)}
      className="grid justify-center gap-1"
      style={{ gridTemplateColumns: `repeat(${String(COLUMNS)}, 2.5rem)` }}
    >
      {BOT_AVATARS.map((file, index) => {
        const selected = file === value

        return (
          <button
            key={file}
            ref={(node) => {
              tiles.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={botAvatarLabel(file)}
            title={botAvatarLabel(file)}
            tabIndex={selected ? 0 : -1}
            onFocus={() => setFocused(index)}
            onPointerEnter={() => onPreview(file)}
            onClick={() => onChange(file)}
            className={clsx(
              'group/tile flex size-10 items-center justify-center rounded-lg outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-zViolet-500',
              selected ? 'bg-zViolet-500/15 ring-1 ring-zViolet-500/70' : 'hover:bg-zGray-800/70',
            )}
          >
            <BotAvatarImage
              file={file}
              className="size-8 object-contain transition-transform duration-150 ease-out group-hover/tile:scale-110 motion-reduce:transition-none motion-reduce:group-hover/tile:scale-100"
            />
          </button>
        )
      })}
    </div>
  )
}
