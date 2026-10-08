import 'react-grid-layout/css/styles.css'

import ReactGridLayout, { useContainerWidth } from 'react-grid-layout'

import { DelayedPanelReveal } from './homeAnimation'
import { GRID_COLUMNS, gridFor } from './homeWidgetSettings'

import type { HomeGridItem } from '../../../types/team.ts'
import type { ReactElement } from 'react'
import type { Layout } from 'react-grid-layout'

const toItems = (layout: Layout): HomeGridItem[] =>
  layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))

/**
 * The home cards on a Grafana-style grid: drag a card by its header, resize
 * it from the bottom-right corner. Each card keeps its own staggered reveal.
 */
export function HomeGrid({
  cards,
  saved,
  onChange,
  revealAt,
  replayKey,
}: {
  /** Keyed elements; the key is the card's grid id. */
  cards: ReactElement[]
  saved: HomeGridItem[] | undefined
  onChange: (grid: HomeGridItem[]) => void
  revealAt: number
  replayKey: number
}) {
  const { width, containerRef, mounted } = useContainerWidth()
  const layout = gridFor(
    cards.map((card) => String(card.key)),
    saved,
  )

  return (
    <div ref={containerRef}>
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
          dragConfig={{ handle: '.home-card-drag', cancel: 'button' }}
          onDragStop={(next) => onChange(toItems(next))}
          onResizeStop={(next) => onChange(toItems(next))}
        >
          {cards.map((card, i) => (
            <div key={card.key}>
              <DelayedPanelReveal
                replayKey={replayKey}
                delayMs={revealAt + 150 * i}
                className="h-full"
              >
                {card}
              </DelayedPanelReveal>
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  )
}
