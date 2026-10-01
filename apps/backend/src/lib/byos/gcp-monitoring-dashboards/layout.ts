import type { PlacedWidget, RawDashboard, RawWidget } from './types'

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value)

  return Number.isInteger(n) && n > 0 ? n : fallback
}

function clampColumns(value: unknown, fallback = 24): number {
  return Math.min(48, Math.max(1, positiveInt(value, fallback)))
}

export function placeWidgets(raw: RawDashboard): { columns: number; placed: PlacedWidget[] } {
  if (raw.mosaicLayout) {
    const columns = clampColumns(raw.mosaicLayout.columns, 48)
    const placed: PlacedWidget[] = (raw.mosaicLayout.tiles ?? [])
      .filter((tile): tile is typeof tile & { widget: RawWidget } => !!tile.widget)
      .map((tile, index) => ({
        ref: `mosaic:${String(index)}`,
        widget: tile.widget,
        layout: {
          x: Math.max(0, Math.min(columns - 1, Math.floor(tile.xPos ?? 0))),
          y: Math.max(0, Math.floor(tile.yPos ?? 0)),
          w: Math.max(1, Math.min(columns, Math.floor(tile.width ?? columns))),
          h: Math.max(1, Math.floor(tile.height ?? 8)),
        },
      }))

    const groups = placed.filter((item) => item.widget.collapsibleGroup)

    for (const item of placed) {
      if (item.widget.collapsibleGroup) continue
      const group = groups.find(
        (candidate) =>
          item.layout.x >= candidate.layout.x &&
          item.layout.y >= candidate.layout.y &&
          item.layout.x + item.layout.w <= candidate.layout.x + candidate.layout.w &&
          item.layout.y + item.layout.h <= candidate.layout.y + candidate.layout.h,
      )

      item.groupRef = group?.ref ?? null
    }

    return { columns, placed }
  }

  if (raw.gridLayout) {
    const columns = clampColumns(raw.gridLayout.columns, 2)
    const height = 8
    const placed = (raw.gridLayout.widgets ?? []).map((widget, index) => ({
      ref: `grid:${String(index)}`,
      widget,
      layout: { x: index % columns, y: Math.floor(index / columns) * height, w: 1, h: height },
      groupRef: null,
    }))

    return { columns, placed }
  }

  if (raw.rowLayout) {
    const columns = 24
    const placed: PlacedWidget[] = []
    let y = 0

    for (const [rowIndex, row] of (raw.rowLayout.rows ?? []).entries()) {
      const widgets = row.widgets ?? []
      const height = Math.max(4, positiveInt(row.weight, 1) * 6)

      for (const [widgetIndex, widget] of widgets.entries()) {
        const x = Math.floor((widgetIndex * columns) / Math.max(1, widgets.length))
        const end = Math.floor(((widgetIndex + 1) * columns) / Math.max(1, widgets.length))

        placed.push({
          ref: `row:${String(rowIndex)}:${String(widgetIndex)}`,
          widget,
          layout: { x, y, w: Math.max(1, end - x), h: height },
          groupRef: null,
        })
      }
      y += height
    }

    return { columns, placed }
  }

  if (raw.columnLayout) {
    const columns = 24
    const inputColumns = raw.columnLayout.columns ?? []
    const weights = inputColumns.map((column) => positiveInt(column.weight, 1))
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1
    const placed: PlacedWidget[] = []
    let accumulatedWeight = 0

    for (const [columnIndex, column] of inputColumns.entries()) {
      const x = Math.floor((accumulatedWeight * columns) / totalWeight)

      accumulatedWeight += weights[columnIndex] ?? 1
      const end = Math.floor((accumulatedWeight * columns) / totalWeight)

      for (const [widgetIndex, widget] of (column.widgets ?? []).entries()) {
        placed.push({
          ref: `column:${String(columnIndex)}:${String(widgetIndex)}`,
          widget,
          layout: { x, y: widgetIndex * 8, w: Math.max(1, end - x), h: 8 },
          groupRef: null,
        })
      }
    }

    return { columns, placed }
  }

  return { columns: 24, placed: [] }
}

export function widgetFromRef(raw: RawDashboard, ref: string): RawWidget | null {
  const parts = ref.split(':')
  const indexes = parts.slice(1).map((value) => Number(value))

  if (indexes.some((value) => !Number.isInteger(value) || value < 0)) return null
  if (parts[0] === 'mosaic' && indexes.length === 1) {
    return raw.mosaicLayout?.tiles?.[indexes[0]!]?.widget ?? null
  }
  if (parts[0] === 'grid' && indexes.length === 1) {
    return raw.gridLayout?.widgets?.[indexes[0]!] ?? null
  }
  if (parts[0] === 'row' && indexes.length === 2) {
    return raw.rowLayout?.rows?.[indexes[0]!]?.widgets?.[indexes[1]!] ?? null
  }
  if (parts[0] === 'column' && indexes.length === 2) {
    return raw.columnLayout?.columns?.[indexes[0]!]?.widgets?.[indexes[1]!] ?? null
  }

  return null
}
