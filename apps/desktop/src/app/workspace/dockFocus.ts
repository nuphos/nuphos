import { composerOf } from '../../components/agent/panel/modelSelectorParts'

/**
 * ⌘J is an explicit move, so the caret follows the dock: in, to the visible
 * terminal (xterm's own focus target) or else the tab surface; out, back to
 * this pane's composer when the caret was in the dock it just hid.
 */
export function moveFocusWithDock(dock: HTMLElement | null, opening: boolean) {
  if (!dock) return
  if (opening) {
    const terminal = [...dock.querySelectorAll<HTMLElement>('.xterm-helper-textarea')].find((el) =>
      el.checkVisibility(),
    )

    ;(terminal ?? dock.querySelector<HTMLElement>('[data-workspace-focus-surface="tab"]'))?.focus({
      preventScroll: true,
    })

    return
  }
  const active = document.activeElement

  if (active && active !== document.body && !dock.contains(active)) return
  composerOf(dock)
    ?.querySelector<HTMLElement>('[aria-label="Message"]')
    ?.focus({ preventScroll: true })
}
