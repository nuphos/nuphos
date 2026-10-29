import 'react-grid-layout/css/styles.css'

import { useMemo, useRef, useState } from 'react'
import ReactGridLayout, { useContainerWidth } from 'react-grid-layout'

import { SectionGrip } from '../../../views/settings/SectionGrip'
import { moveAnnouncement } from '../../../views/settings/sectionOrderPresentation'

import { DelayedPanelReveal } from './homeAnimation'
import { cardsInReadingOrder, compactAround, compactGrid, moveCard } from './homeGridFlow'
import { GRID_COLUMNS, gridFor, minCardSize } from './homeWidgetSettings'

import type { HomeGridItem } from '../../../types/team.ts'
import type { ReactElement } from 'react'
import type { Compactor, Layout } from 'react-grid-layout'

const toItems = (layout: Layout): HomeGridItem[] =>
  layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))

const sameGrid = (a: HomeGridItem[], b: HomeGridItem[]) =>
  a.length === b.length &&
  a.every((item) => {
    const other = b.find((o) => o.i === item.i)

    return other?.x === item.x && other.y === item.y && other.w === item.w && other.h === item.h
  })

/**
 * The home cards on a grid that stays compact, as in Notion. Each card shows a
 * six-dot grip on hover, as on the Agents page: drag it (or the card's header)
 * and the other cards move aside to an outline where it will land, or click it
 * for Move up and Move down, also Alt+Up and Alt+Down while it has focus. Moves
 * go by reading order and are announced. A card resizes from its bottom-right
 * corner, and each keeps its own staggered reveal. A saved layout with gaps is
 * shown compacted, and saved that way on the next change.
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
  // The card being dragged, and the reading order of all cards when it was picked up.
  const drag = useRef<{ id: string; before: string[] } | null>(null)
  // Keeps the grid compact while a card is dragged or resized, so the others
  // move aside live and no gap is left behind.
  const compactor = useMemo<Compactor>(
    () => ({
      type: 'vertical',
      allowOverlap: false,
      compact: (next) =>
        drag.current
          ? compactAround(next, drag.current.id, drag.current.before)
          : compactGrid(next),
    }),
    [],
  )
  const grid = compactGrid(
    gridFor(
      cards.map((card) => String(card.key)),
      saved,
    ),
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
          compactor={compactor}
          gridConfig={{
            cols: GRID_COLUMNS,
            rowHeight: 28,
            margin: [12, 12],
            containerPadding: [0, 0],
          }}
          dragConfig={{ handle: '.home-card-drag', cancel: 'button:not(.home-card-grip)' }}
          onDragStart={(_layout, item) => {
            if (item) drag.current = { id: item.i, before: order }
          }}
          onDragStop={(next, from, to) => {
            drag.current = null
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
