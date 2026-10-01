export type SplitLayout = { id: string } | { direction: 'row' | 'column'; children: SplitLayout[] }
export type PaneRect = { id: string; left: number; top: number; width: number; height: number }

export function splitPane(
  layout: SplitLayout,
  target: string,
  id: string,
  direction: 'row' | 'column',
): SplitLayout {
  if ('id' in layout) {
    return layout.id === target ? { direction, children: [layout, { id }] } : layout
  }
  // Repeating a direction adds an equal-sized sibling rather than repeatedly halving it.
  if (
    layout.direction === direction &&
    layout.children.some((child) => 'id' in child && child.id === target)
  ) {
    const children = [...layout.children]

    children.splice(children.findIndex((child) => 'id' in child && child.id === target) + 1, 0, {
      id,
    })

    return { ...layout, children }
  }

  return {
    ...layout,
    children: layout.children.map((child) => splitPane(child, target, id, direction)),
  }
}

export function removePane(layout: SplitLayout, id: string): SplitLayout | null {
  if ('id' in layout) return layout.id === id ? null : layout
  const children = layout.children
    .map((child) => removePane(child, id))
    .filter((child): child is SplitLayout => child !== null)

  if (children.length === 0) return null

  return children.length === 1 ? children[0] : { ...layout, children }
}

export function paneRects(
  layout: SplitLayout,
  rect = { left: 0, top: 0, width: 100, height: 100 },
): PaneRect[] {
  if ('id' in layout) return [{ id: layout.id, ...rect }]

  return layout.children.flatMap((child, index) => {
    const horizontal = layout.direction === 'row'

    return paneRects(child, {
      left: rect.left + (horizontal ? (index * rect.width) / layout.children.length : 0),
      top: rect.top + (horizontal ? 0 : (index * rect.height) / layout.children.length),
      width: horizontal ? rect.width / layout.children.length : rect.width,
      height: horizontal ? rect.height : rect.height / layout.children.length,
    })
  })
}
