import { useEffect, useInsertionEffect, useRef } from 'react'

import { TOOL_KEYS, isEditableTarget } from './tools'

import type { Tool } from './tools'
import type { RefObject } from 'react'

type Args = {
  containerRef: RefObject<HTMLElement | null>
  /** A dialog or the player is up: the canvas is not what the keys are for. */
  suspended: boolean
  onEscape: () => void
  onTool: (tool: Tool) => void
  undo: () => void
  redo: () => void
  copy: () => void
  paste: () => void
  duplicate: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomTo: (zoom: number) => void
  fitAll: () => void
  fitSelection: () => void
}

/** The canvas's keyboard: tools, clipboard, history and zoom, while nothing else has the keys. */
export function useCanvasShortcuts(args: Args) {
  // The handler reads the latest args through a ref, so the listener mounts once.
  const argsRef = useRef(args)

  useInsertionEffect(() => {
    argsRef.current = args
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = argsRef.current

      if (a.suspended || isEditableTarget(e.target)) return
      const container = a.containerRef.current
      const target = e.target as HTMLElement | null

      if (!container || (target && target !== document.body && !container.contains(target))) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      if (e.key === 'Escape') a.onEscape()
      else if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) a.redo()
        else a.undo()
      } else if (mod && key === 'c') a.copy()
      // ⌘D splits the window in Nuphos, so Duplicate lives on ⌘⇧V.
      else if (mod && e.shiftKey && key === 'v') {
        e.preventDefault()
        a.duplicate()
      } else if (mod && key === 'v') a.paste()
      else if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        a.zoomIn()
      } else if (mod && e.key === '-') {
        e.preventDefault()
        a.zoomOut()
      } else if (mod && e.key === '0') {
        e.preventDefault()
        a.zoomTo(1)
      } else if (e.shiftKey && e.key === '!') a.fitAll()
      else if (e.shiftKey && e.key === '@') a.fitSelection()
      else if (!mod && !e.altKey && TOOL_KEYS[key]) a.onTool(TOOL_KEYS[key])
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
