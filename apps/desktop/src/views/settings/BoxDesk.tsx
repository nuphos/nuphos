import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { deskOpenDelay } from './boxDeskModel'

import './BoxDesk.css'

import type { DeskModel } from './boxDeskModel'
import type { CSSProperties, ReactNode } from 'react'

// Every machine on the page shares one opening, however many there are and whenever each appears.
const openingWave = { at: -Infinity }

// A laptop keyboard's rows in key widths: the half-height function row, then the letters down
// to the space bar. 0 marks the inverted-T arrow keys.
const KEY_ROWS = [
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.75],
  [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
  [1, 1, 1, 1.25, 5, 1.25, 1, 0],
]

function Keyboard() {
  return (
    <div className="desk-keys">
      {KEY_ROWS.map((row, r) => (
        <div key={r} className="desk-keyrow">
          {row.map((width, k) =>
            width ? (
              <i key={k} className="desk-key" style={{ flexGrow: width }} />
            ) : (
              <span key={k} className="desk-arrows">
                <i className="desk-key" />
                <i className="desk-key" />
                <i className="desk-key" />
                <i className="desk-key" />
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  )
}

/** Only a Box carries a maker's mark, InstaBox's, as iOS prints it; the desk draws other machines'
 * shape, not someone else's logo. */
function Mark({ brand }: { brand: DeskModel['brand'] }) {
  if (brand !== 'nuphos') return null

  return <i className="desk-mark is-nuphos" aria-hidden />
}

/** Folded shut under the viewer; the lid swings up as the view turns to face it. */
function Laptop({ brand, screen }: { brand: DeskModel['brand']; screen: ReactNode }) {
  return (
    <>
      <div className="desk-deck">
        <Keyboard />
        <i className="desk-pad" />
        <i className="desk-edge" />
      </div>
      <div className="desk-lid">
        <div className="desk-face desk-outer">
          <Mark brand={brand} />
        </div>
        <div className="desk-face desk-inner">
          <div className="desk-glass">
            {screen}
            <i className={brand === 'apple' ? 'desk-notch' : 'desk-cam'} />
          </div>
          <i className="desk-hinge" />
        </div>
      </div>
    </>
  )
}

/** A Mac mini, a Linux machine or a Box: its top from above, then its front as the view turns. */
/** How many outlines of the top stack up into a solid body: one every 2px of its 56px height. */
const BODY_SLICES = 28

function MiniBox({ brand, solid = false }: { brand: DeskModel['brand']; solid?: boolean }) {
  return (
    <>
      <i className="desk-mini-shadow" />
      {solid &&
        Array.from({ length: BODY_SLICES }, (_, index) => (
          <i
            key={index}
            className="desk-mini-slice"
            style={{ '--up': index / (BODY_SLICES - 1) } as CSSProperties}
          />
        ))}
      <div className="desk-mini">
        <Mark brand={brand} />
        <div className="desk-mini-front">
          <i className="desk-mini-port" />
          <i className="desk-mini-port" />
          <i className="desk-mini-jack" />
        </div>
      </div>
    </>
  )
}

/** Every machine starts seen from above; once the page shows it and it is on, the view turns to face
 * it. Each stands in the same space on the same baseline. A laptop shows its readings on its screen;
 * a box shows them in a card beside it, inside the same space, never over the machine. */
export function DeskArt({
  model,
  on,
  facing = false,
  solid = false,
  children,
}: {
  model: DeskModel
  /** A paused or unreachable machine stays shut, with an unlit power light and no readings. */
  on: boolean
  /** Already facing the viewer when it appears, with no turn: one arriving from elsewhere. */
  facing?: boolean
  /**
   * A box with a solid body under its top, so its sides keep the top's round corners at every
   * angle of the turn: for whoever shows it turning up close.
   */
  solid?: boolean
  /** The machine's readings and agents. A box without them has no card beside it. */
  children?: ReactNode
}) {
  const [opened, setOpened] = useState(facing)
  // A machine that is off stays shut; it opens once it is on.
  const open = on && opened

  useEffect(() => {
    if (!on || opened) return

    const timer = window.setTimeout(
      () => setOpened(true),
      deskOpenDelay(performance.now(), openingWave),
    )

    return () => window.clearTimeout(timer)
  }, [on, opened])

  const laptop = model.form === 'laptop'
  // Nothing on it can be reached until it has turned to face the viewer.
  const panel = (className: string) => (
    <div className={className} inert={!open}>
      {children}
    </div>
  )
  const screen = (
    <div className={clsx('desk-screen', !on && 'is-off')}>
      {on && <i className="desk-wallpaper" />}
      {on && panel('desk-panel is-screen')}
    </div>
  )

  return (
    <div
      className={clsx(
        'desk-art',
        `desk-${model.form}`,
        `is-${model.brand}`,
        open && 'is-open',
        !on && 'is-off',
      )}
    >
      <div className="desk-rig" aria-hidden={laptop ? !on : true}>
        {laptop ? (
          <Laptop brand={model.brand} screen={screen} />
        ) : (
          <MiniBox brand={model.brand} solid={solid} />
        )}
      </div>
      {!laptop && on && children !== undefined && panel('desk-panel desk-side')}
    </div>
  )
}
