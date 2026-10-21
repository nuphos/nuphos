export type SplitLayout = { id: string } | { direction: 'row' | 'column'; children: SplitLayout[] }
export type PaneRect = { id: string; left: number; top: number; width: number; height: number }

export function splitPane(
  layout: SplitLayout,
  target: string,
  id: string,
  direction: 'row' | 'column',
  before = false,
): SplitLayout {
  if ('id' in layout) {
    if (layout.id !== target) return layout

    return { direction, children: before ? [{ id }, layout] : [layout, { id }] }
  }
  // Repeating a direction adds an equal-sized sibling rather than repeatedly halving it.
  if (
    layout.direction === direction &&
    layout.children.some((child) => 'id' in child && child.id === target)
  ) {
    const children = [...layout.children]

    children.splice(
      children.findIndex((child) => 'id' in child && child.id === target) + (before ? 0 : 1),
      0,
      { id },
    )

    return { ...layout, children }
  }

  return {
    ...layout,
    children: layout.children.map((child) => splitPane(child, target, id, direction, before)),
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

/** Private drag types, so the split overlay ignores files and text drags. */
export const SESSION_DRAG_TYPE = 'application/x-nuphos-session'
export const PANE_DRAG_TYPE = 'application/x-nuphos-pane'

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

/** Edge bands a quarter deep split that side; the middle replaces the pane. */
export function dropZone(x: number, y: number): DropZone {
  const edges = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ] as const
  const [zone, distance] = edges.reduce((a, b) => (b[1] < a[1] ? b : a))

  return distance < 0.25 ? zone : 'center'
}

function hasPane(layout: SplitLayout, id: string): boolean {
  return 'id' in layout ? layout.id === id : layout.children.some((child) => hasPane(child, id))
}

/** Exchanges two panes' places; the tree keeps its shape. */
export function swapPanes(layout: SplitLayout, a: string, b: string): SplitLayout {
  if ('id' in layout) {
    if (layout.id === a) return { id: b }

    return layout.id === b ? { id: a } : layout
  }

  return { ...layout, children: layout.children.map((child) => swapPanes(child, a, b)) }
}

/**
 * Places `id` on `zone`'s side of `target`, taking it out of its old spot
 * first; a new id splits `target`. The center swaps two panes already shown.
 */
export function dropPane(
  layout: SplitLayout,
  target: string,
  id: string,
  zone: DropZone,
): SplitLayout {
  if (id === target) return layout
  if (zone === 'center') return hasPane(layout, id) ? swapPanes(layout, target, id) : layout
  const rest = removePane(layout, id) ?? layout

  return splitPane(
    rest,
    target,
    id,
    zone === 'left' || zone === 'right' ? 'row' : 'column',
    zone === 'left' || zone === 'top',
  )
}

/** Stands in for a chat that would open in a new pane while a drag shows where it lands. */
export const PREVIEW_PANE = 'drop-preview'

/** What letting go would do now; `pane` is the dragged pane, null for a sidebar chat. */
export type DropPreview = { target: string; zone: DropZone; pane: string | null }

/** The layout a drop would leave, so panes can move there before the pointer is released. */
export function previewDrop(layout: SplitLayout, preview: DropPreview | null): SplitLayout {
  if (!preview) return layout
  if (preview.pane) return dropPane(layout, preview.target, preview.pane, preview.zone)

  return preview.zone === 'center'
    ? layout
    : dropPane(layout, preview.target, PREVIEW_PANE, preview.zone)
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

/** macOS shell control keys must not invoke Command shortcuts. */
export function isSplitShortcut(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'code' | 'isComposing'>,
  mac: boolean,
): boolean {
  return (
    (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    !event.altKey &&
    event.code === 'KeyD' &&
    !event.isComposing
  )
}

/**
 * The pane a ⌘-click reuses: the one the last ⌘-click filled, as long as it
 * still shows that chat and is not the pane the click came from.
 */
export function reusableBesidePane(
  last: { pane: string; sessionId: string } | null,
  source: string,
  shownIn: (pane: string) => string | null | undefined,
): string | null {
  return last && last.pane !== source && shownIn(last.pane) === last.sessionId ? last.pane : null
}

/** A window's search belongs to its current focus, never to a hidden pane. */
export function focusPaneState(
  previous: { activeId: string; sessionSearchOpen: boolean },
  activeId: string,
) {
  return previous.activeId === activeId ? previous : { activeId, sessionSearchOpen: false }
}
