import clsx from 'clsx'

import { defaultBotName } from './createStarterBot'
import { FACES, faceSrc } from './faces'

/** Two rows of faces that scroll sideways, fading out at whichever edge hides more. */
export function FacePicker({ face, onPick }: { face: string; onPick: (face: string) => void }) {
  return (
    <div className="t-scroll-fade-x -mx-6 overflow-x-auto px-6 [scrollbar-width:none]">
      <div className="grid w-max auto-cols-[56px] grid-flow-col grid-rows-[56px_56px] gap-3">
        {FACES.map((name) => (
          <button
            key={name}
            type="button"
            aria-label={defaultBotName(name)}
            aria-pressed={face === name}
            onClick={() => onPick(name)}
            className={clsx(
              'grid place-items-center rounded-full border-2 p-[3px] transition-colors',
              face === name
                ? 'border-[rgb(var(--color-text-base))]'
                : 'border-transparent hover:border-line-control',
            )}
          >
            <img
              src={faceSrc(name)}
              alt=""
              className="size-[46px] rounded-full bg-surface-sunken object-contain"
            />
          </button>
        ))}
      </div>
    </div>
  )
}
