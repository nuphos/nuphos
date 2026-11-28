import clsx from 'clsx'

import { DeskArt } from '../../settings/BoxDesk'
import { LiveDot } from '../../settings/BoxParts'
import '../../settings/BoxDeskInfo.css'
import './ComputerCard.css'

import type { DeskModel } from '../../settings/boxDeskModel'
import type { CSSProperties, ReactNode, Ref } from 'react'

/**
 * One computer as the Computers page shows it: the machine, its runtimes in the card
 * beside it, then its name and a status line. No readings: here it only shows that
 * runtimes run on a computer.
 *
 * It takes up only the machine's width, with its name and state centered under the machine:
 * the runtimes card hangs over the right, so it is left out when the page centers it.
 */
export function ComputerCard({
  model,
  name,
  mark,
  status,
  detail,
  facing = false,
  artRef,
  artStyle,
  revealed = true,
  children,
}: {
  model: DeskModel
  name: string
  /** A logo before the name, as a brand's machine shows it. */
  mark?: ReactNode
  /** The live state, after a green dot. */
  status: string
  /** What kind of machine it is, after the status. */
  detail: string
  facing?: boolean
  /** The machine's art, for whoever moves it into place. */
  artRef?: Ref<HTMLDivElement>
  artStyle?: CSSProperties
  /** Whether its name and state show yet. */
  revealed?: boolean
  /** Its runtimes, in the card beside it; none, no card. */
  children?: ReactNode
}) {
  return (
    <div className="tour-computer flex w-[175px] shrink-0 flex-col text-center">
      {/* The art is wider than the machine; it starts 25px left of the machine's face. */}
      <div ref={artRef} style={artStyle} className="-ml-[25px] w-[300px]">
        <DeskArt model={model} on facing={facing} solid>
          {children}
        </DeskArt>
      </div>
      <div
        className={clsx(
          'transition-opacity duration-300 motion-reduce:transition-none',
          !revealed && 'opacity-0',
        )}
      >
        <p className="mt-2 flex items-center justify-center gap-1.5 text-[13px] font-medium leading-6 text-main">
          {mark}
          <span className="truncate">{name}</span>
        </p>
        <p className="mt-0.5 flex items-center justify-center gap-1.5 text-[11.5px] leading-4 text-tertiary">
          <LiveDot />
          {status}
          <span aria-hidden>·</span>
          {detail}
        </p>
      </div>
    </div>
  )
}

/** A runtime's square in the card: the shape the Computers page gives an agent. */
export const TILE =
  'relative flex h-7 w-7 items-center justify-center rounded-lg bg-state-selected transition-[background-color,opacity]'

/** The runtimes of a computer, in rows. */
export function TileGrid({
  label,
  columns = 3,
  children,
}: {
  label: string
  /** How many squares a row holds; the card is as wide as that. */
  columns?: number
  children: ReactNode
}) {
  return (
    <ul
      className="desk-agents"
      aria-label={label}
      style={{ '--tile-columns': columns } as CSSProperties}
    >
      {children}
    </ul>
  )
}
