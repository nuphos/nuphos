import { focusAtEnd } from '../../components/agent/panel/composerSerialize'
import { composerOf } from '../../components/agent/panel/modelSelectorParts'
import { nextRegion } from '../../lib/regionShortcut'

/** The visible terminal in the dock (xterm's own focus target), or else its tab surface. */
function focusDockContent(dock: HTMLElement) {
  const terminal = [...dock.querySelectorAll<HTMLElement>('.xterm-helper-textarea')].find((el) =>
    el.checkVisibility(),
  )

  ;(terminal ?? dock.querySelector<HTMLElement>('[data-workspace-focus-surface="tab"]'))?.focus({
    preventScroll: true,
  })
}

/** This pane's message box: the composer sharing the dock's pane. */
function composerBox(dock: HTMLElement) {
  return composerOf(dock)?.querySelector<HTMLElement>('[aria-label="Message"]') ?? null
}

/**
 * ⌘J is an explicit move, so the caret follows the dock: in, to its content;
 * out, back to this pane's composer when the caret was in the dock it just hid.
 */
export function moveFocusWithDock(dock: HTMLElement | null, opening: boolean) {
  if (!dock) return
  if (opening) {
    focusDockContent(dock)

    return
  }
  const active = document.activeElement
  const box = composerBox(dock)

  if (active && active !== document.body && !dock.contains(active)) return
  if (box) focusAtEnd(box)
}

/** F6 / ⇧F6 move the caret between the sidebar, the conversation and the open dock. */
export function cycleFocusRegion(dock: HTMLElement | null, dockOpen: boolean, step: 1 | -1) {
  const sidebar = document.querySelector<HTMLElement>('[data-focus-region="sidebar"]')
  const box = dock && composerBox(dock)
  const regions: { root: Element; focus: () => void }[] = []

  if (sidebar) {
    const row = sidebar.querySelector<HTMLElement>('[aria-current="page"]')

    regions.push({
      root: sidebar,
      focus: () => (row ?? sidebar.querySelector<HTMLElement>('nav button'))?.focus(),
    })
  }
  if (box) {
    const session = box.closest('[data-workspace-focus-surface="session"]') ?? box

    regions.push({ root: session, focus: () => focusAtEnd(box) })
  }
  if (dock && dockOpen) regions.push({ root: dock, focus: () => focusDockContent(dock) })
  const active = document.activeElement
  const current = regions.findIndex((region) => active && region.root.contains(active))

  regions[nextRegion(current, regions.length, step)]?.focus()
}
