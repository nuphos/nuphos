import type { GridPos, Panel, RepeatValue } from './types'

export type PlacedPanel = { panel: Panel; pos: GridPos }

export type PanelBlock = {
  panels: PlacedPanel[]
  // Total height of the block in grid rows.
  heightRows: number
}

export type DashboardSection =
  { kind: 'panels'; block: PanelBlock } | { kind: 'row'; row: Panel; block: PanelBlock }

export type RenderSection = DashboardSection & {
  key: string
  repeat?: RepeatValue & { name: string }
}

// Grafana row repeat gives every clone a single-value variable scope. Keeping
// that scope beside the section prevents a multi datasource from leaking into
// each child panel as one invalid combined UID.
export function expandRepeatedRows(
  sections: DashboardSection[],
  valuesByVariable: Record<string, RepeatValue[]>,
): RenderSection[] {
  return sections.flatMap((section, index) => {
    if (section.kind !== 'row' || !section.row.repeat) {
      return [{ ...section, key: `${section.kind}-${String(index)}` }]
    }
    const repeat = section.row.repeat

    if (!(repeat in valuesByVariable)) return [{ ...section, key: `row-${String(index)}` }]

    return valuesByVariable[repeat].map((value) => ({
      ...section,
      key: `row-${String(section.row.id)}-${repeat}-${value.value}`,
      repeat: { name: repeat, ...value },
    }))
  })
}

// Group the saved panel list into renderable sections. Grafana's saved model
// stores an expanded row's panels after it at the top level, but a collapsed
// row's panels nested inside it — so grid coordinates can't be used verbatim.
// Each section's block normalizes panel y positions to start at 0; the view
// stacks sections (and collapses row blocks) itself, which keeps row panels
// mounted while hidden.
export function groupPanels(panels: Panel[]): DashboardSection[] {
  const sections: DashboardSection[] = []

  const makeBlock = (block: Panel[]): PanelBlock => {
    if (block.length === 0) return { panels: [], heightRows: 0 }
    const minY = Math.min(...block.map((p) => p.gridPos.y))
    let heightRows = 0
    const placed = block.map((p) => {
      heightRows = Math.max(heightRows, p.gridPos.y - minY + p.gridPos.h)

      return { panel: p, pos: { ...p.gridPos, y: p.gridPos.y - minY } }
    })

    return { panels: placed, heightRows }
  }

  let i = 0
  const preamble: Panel[] = []

  while (i < panels.length && panels[i].type !== 'row') {
    preamble.push(panels[i])
    i++
  }
  if (preamble.length > 0) {
    sections.push({ kind: 'panels', block: makeBlock(preamble) })
  }

  while (i < panels.length) {
    const row = panels[i]

    i++
    // A panel can appear both nested and at the top level in stale JSON —
    // dedupe by id so it doesn't render twice.
    const seen = new Set<number>()
    const children: Panel[] = []
    const addChild = (p: Panel) => {
      if (seen.has(p.id)) return
      seen.add(p.id)
      children.push(p)
    }

    for (const p of row.panels ?? []) addChild(p)
    while (i < panels.length && panels[i].type !== 'row') {
      addChild(panels[i])
      i++
    }
    sections.push({ kind: 'row', row, block: makeBlock(children) })
  }

  return sections
}
