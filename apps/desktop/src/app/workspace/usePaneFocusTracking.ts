import { useEffect } from 'react'

/** The pane holding the pointer or focus becomes active, webview guests included. */
export function usePaneFocusTracking(
  focusSurfaces: Map<string, string>,
  setActiveId: (id: string) => void,
) {
  useEffect(() => {
    const focusOwner = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return
      const owner = target.closest<HTMLElement>('[data-workspace-split-pane]')

      const id = owner?.dataset.workspaceSplitPane

      if (!id) return
      const surface = target.closest<HTMLElement>('[data-workspace-focus-surface]')?.dataset
        .workspaceFocusSurface

      if (surface) focusSurfaces.set(id, surface)
      setActiveId(id)
    }
    const onPointerDown = (event: PointerEvent) => focusOwner(event.composedPath()[0])
    const onFocus = (event: FocusEvent) => focusOwner(event.target)
    // A webview/iframe owns a separate document: its pointer events do not
    // bubble through React. Chromium exposes the guest host as activeElement.
    let frame = 0
    const onBlur = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => focusOwner(document.activeElement))
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focus', onFocus, true)
    window.addEventListener('blur', onBlur)

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focus', onFocus, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [focusSurfaces, setActiveId])
}
