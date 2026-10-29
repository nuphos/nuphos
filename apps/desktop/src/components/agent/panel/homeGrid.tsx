import 'react-grid-layout/css/styles.css'

import { useRef, useState } from 'react'
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout'

import { SectionGrip } from '../../../views/settings/SectionGrip'
import { moveAnnouncement } from '../../../views/settings/sectionOrderPresentation'

import { DelayedPanelReveal } from './homeAnimation'
import {
  GRID_COLUMNS,
  cardsInReadingOrder,
  gridFor,
  minCardSize,
  moveCard,
} from './homeWidgetSettings'

import type { HomeGridItem } from '../../../types/team.ts'
import type { ReactElement } from 'react'
import type { Layout } from 'react-grid-layout'

const toItems = (layout: Layout): HomeGridItem[] =>
  layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))

const sameGrid = (a: HomeGridItem[], b: HomeGridItem[]) =>
  a.length === b.length &&
  a.every((item, n) => {
    const other = b[n]

    return (
      item.i === other.i &&
      item.x === other.x &&
      item.y === other.y &&
      item.w === other.w &&
      item.h === other.h
    )
  })

/**
 * The home cards on a Grafana-style grid. Each card shows a six-dot grip on
 * hover, as on the Agents page: drag it (or the card's header) to move the
 * card, with an outline where it will land, or click it for Move up and Move
 * down, also Alt+Up and Alt+Down while it has focus. Moves go by reading order
 * and are announced. A card resizes from its bottom-right corner, and each
 * keeps its own staggered reveal.
 */
export function HomeGrid({
  cards,
  saved,
  onChange,
  label,
  revealAt,
  replayKey,
}: {
  /** Keyed elements; the key is the card's grid id. */
  cards: ReactElement[]
  saved: HomeGridItem[] | undefined
  onChange: (grid: HomeGridItem[]) => void
  /** A card's name, from its grid id, for its grip and for announcements. */
  label: (key: string) => string
  revealAt: number
  replayKey: number
}) {
  const { width, containerRef, mounted } = useContainerWidth()
  const [announcement, setAnnouncement] = useState('')
  // A drag started on a grip ends with a click on it, which must not open its menu.
  const dragged = useRef(false)
  const grid = gridFor(
    cards.map((card) => String(card.key)),
    saved,
  )
  const layout = grid.map((item) => ({ ...item, ...minCardSize(item.i) }))
  const order = cardsInReadingOrder(grid).map((item) => item.i)

  const announce = (next: HomeGridItem[], id: string) => {
    const position = cardsInReadingOrder(next).findIndex((item) => item.i === id) + 1

    setAnnouncement(moveAnnouncement(label(id), position, next.length))
  }
  const save = (next: HomeGridItem[]) => {
    if (!sameGrid(next, grid)) onChange(next)
  }

  return (
    <div ref={containerRef} className="home-grid">
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: GRID_COLUMNS,
            rowHeight: 28,
            margin: [12, 12],
            containerPadding: [0, 0],
          }}
          dragConfig={{ handle: '.home-card-drag', cancel: 'button:not(.home-card-grip)' }}
          onDragStop={(next, from, to) => {
            const items = toItems(next)

            if (from && to && (from.x !== to.x || from.y !== to.y)) {
              dragged.current = true
              // Cleared once the click that ends this press has gone by.
              setTimeout(() => {
                dragged.current = false
              })
              announce(items, to.i)
            }
            save(items)
          }}
          onResizeStop={(next) => save(toItems(next))}
        >
          {cards.map((card, i) => {
            const id = String(card.key)
            const index = order.indexOf(id)

            return (
              <div
                key={card.key}
                onClickCapture={(event) => {
                  if (!dragged.current) return
                  event.stopPropagation()
                  event.preventDefault()
                }}
              >
                <DelayedPanelReveal
                  replayKey={replayKey}
                  delayMs={revealAt + 150 * i}
                  className="group/section relative h-full"
                >
                  <SectionGrip
                    label={label(id)}
                    canMoveUp={index > 0}
                    canMoveDown={index < order.length - 1}
                    onMove={(step) => {
                      const next = moveCard(grid, id, step)

                      announce(next, id)
                      save(next)
                    }}
                    // A 12x20 grip in the card's padding, so the header does not move, with
                    // an invisible 24x24 area around it to press.
                    className="home-card-drag home-card-grip absolute left-0.5 top-3 z-10 h-5 w-3 before:absolute before:-inset-x-1.5 before:-inset-y-0.5 before:content-[''] [&>svg]:h-3.5 [&>svg]:w-3.5"
                  />
                  {card}
                </DelayedPanelReveal>
              </div>
            )
          })}
        </ReactGridLayout>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}
