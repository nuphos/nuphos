import clsx from 'clsx'
import { useEffect, useState } from 'react'

import { deskOpenDelay } from './boxDeskModel'

import './BoxDesk.css'

import type { DeskModel } from './boxDeskModel'
import type { ReactNode } from 'react'

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

/** A Box carries Nuphos's mark on its top, as in public/logo-dark-bg.svg, inline so it stays sharp.
 * Other machines carry no maker's mark: the desk draws their shape, not someone else's logo. */
function Mark({ brand }: { brand: DeskModel['brand'] }) {
  if (brand !== 'nuphos') return null

  return (
    <svg className="desk-mark is-nuphos" viewBox="21 27 86 74" aria-hidden>
      <path d="M37.1323 73.6672L55.8435 91.9522L49.3132 98.6348L31.1647 80.8997C20.5429 70.5198 20.381 56.4724 31.1046 45.4989C41.4844 34.8771 55.5319 34.7152 66.1537 45.0951L84.3022 62.8302L77.7031 69.5831L58.9918 51.2981C52.4499 44.9052 43.6893 45.1452 37.0902 51.8982C30.6973 58.4401 30.6607 67.343 37.1323 73.6672Z" />
      <path d="M69.2383 77.3454C75.7098 83.6695 84.6096 83.4279 91.0024 76.886C97.6016 70.1331 97.6397 61.3692 91.0978 54.9763L72.3866 36.6913L78.9857 29.9384L97.1342 47.6734C107.756 58.0533 107.918 72.1007 97.5379 82.7225C86.8144 93.6961 72.7669 93.8579 62.1451 83.478L43.9966 65.7429L50.527 59.0604L69.2383 77.3454Z" />
    </svg>
  )
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

/** A Mac mini or a Box: its top from above, then its front as the view turns. */
function MiniBox({ brand }: { brand: DeskModel['brand'] }) {
  return (
    <>
      <i className="desk-mini-shadow" />
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

/** Every machine starts seen from above; once the page shows it, the view turns to face it. Each
 * stands in the same space on the same baseline. A laptop shows its readings on its screen; a box
 * shows them in a card beside it, inside the same space, never over the machine. */
export function DeskArt({
  model,
  on,
  children,
}: {
  model: DeskModel
  /** A paused or unreachable machine keeps a dark screen and an unlit power light, and no readings. */
  on: boolean
  /** The machine's readings and agents. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(
      () => setOpen(true),
      deskOpenDelay(performance.now(), openingWave),
    )

    return () => window.clearTimeout(timer)
  }, [])

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
        {laptop ? <Laptop brand={model.brand} screen={screen} /> : <MiniBox brand={model.brand} />}
      </div>
      {!laptop && on && panel('desk-panel desk-side')}
    </div>
  )
}
