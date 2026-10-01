import type { PanelBlock, PlacedPanel } from './layout'

export const GRID_COLS = 24

// Grafana collapses its 24-column grid on narrow screens; the desktop's
// dockable panes reach phone widths too, so the same breakpoints apply to
// the pane, not the window.
export function columnsForWidth(width: number): number {
  if (width <= 0 || width >= 900) return GRID_COLS
  if (width >= 560) return 2

  return 1
}

function spanFor(w: number, columns: number): number {
  if (columns === GRID_COLS) return w
  if (columns === 1) return GRID_COLS

  return w > GRID_COLS / 2 ? GRID_COLS : GRID_COLS / 2
}

// Re-pack a block for fewer usable columns: panels keep their reading order
// (top-to-bottom, left-to-right) and height, widen to the column span, and
// float up to the first row where they fit — the same packing Grafana's
// grid applies on mobile.
export function reflowBlock(block: PanelBlock, columns: number): PanelBlock {
  if (columns === GRID_COLS || block.panels.length === 0) return block
  const ordered = [...block.panels].sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x)
  const heights = new Array<number>(GRID_COLS).fill(0)
  let heightRows = 0
  const panels: PlacedPanel[] = ordered.map((placed) => {
    const w = spanFor(placed.pos.w, columns)
    let best = { x: 0, y: Number.POSITIVE_INFINITY }

    for (let x = 0; x + w <= GRID_COLS; x += w) {
      const y = Math.max(...heights.slice(x, x + w))

      if (y < best.y) best = { x, y }
    }
    for (let x = best.x; x < best.x + w; x++) heights[x] = best.y + placed.pos.h
    heightRows = Math.max(heightRows, best.y + placed.pos.h)

    return { panel: placed.panel, pos: { x: best.x, y: best.y, w, h: placed.pos.h } }
  })

  return { panels, heightRows }
}
