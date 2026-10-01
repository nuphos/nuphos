import { useEffect, useRef, useState } from 'react'

import { buildValueIndex, describeElement, sampleElement } from './scan'

import type { RegistrySnapshot } from './types'

export type InspectResult = {
  label: string
  tokens: string[]
}

// Inspect mode: hovering highlights the element under the cursor; clicking
// selects it and fires `onResult` with the tokens it uses. Esc or toggling off
// exits. The overlay is imperative (outside React) and tagged data-dev-palette
// so it and the panel are excluded from inspection.
export function useInspect(registry: RegistrySnapshot, onResult: (result: InspectResult) => void) {
  const [active, setActive] = useState(false)
  const onResultRef = useRef(onResult)

  useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])

  useEffect(() => {
    if (!active) return

    const index = buildValueIndex(registry)

    const overlay = document.createElement('div')

    overlay.setAttribute('data-dev-palette', '')
    overlay.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:1000',
      'display:none',
      'border:2px solid rgb(var(--color-zViolet-accent))',
      'background:rgba(var(--color-zViolet-accent),0.12)',
      'border-radius:3px',
      'transition:left 60ms ease,top 60ms ease,width 60ms ease,height 60ms ease',
    ].join(';')
    document.body.appendChild(overlay)

    const prevCursor = document.body.style.cursor

    document.body.style.cursor = 'crosshair'

    const isOwn = (t: EventTarget | null) =>
      t instanceof Element && t.closest('[data-dev-palette]') !== null

    const onMove = (e: PointerEvent) => {
      const target = e.target as Element | null

      if (!target || isOwn(target)) {
        overlay.style.display = 'none'

        return
      }
      const r = target.getBoundingClientRect()

      overlay.style.display = 'block'
      overlay.style.left = `${String(r.left)}px`
      overlay.style.top = `${String(r.top)}px`
      overlay.style.width = `${String(r.width)}px`
      overlay.style.height = `${String(r.height)}px`
    }

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null

      if (!target || isOwn(target)) return
      e.preventDefault()
      e.stopPropagation()
      const sample = sampleElement(target, index)

      onResultRef.current({
        label: describeElement(target),
        tokens: [...sample.tokens].sort((a, b) => a.localeCompare(b)),
      })
      setActive(false)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setActive(false)
      }
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKey, true)

    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKey, true)
      overlay.remove()
      document.body.style.cursor = prevCursor
    }
  }, [active, registry])

  return {
    active,
    toggle: () => setActive((a) => !a),
  }
}
