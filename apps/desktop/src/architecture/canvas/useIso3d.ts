import { useEffect, useRef, useState } from 'react'

import type { ReactFlowInstance } from '@xyflow/react'

export function useIso3d(threeD: boolean) {
  // 3D view pan/zoom (own transform — ReactFlow's pan/zoom is unreliable under
  // the CSS 3D rotation, so we drive translate/scale on the tilt wrapper).
  const [iso3d, setIso3d] = useState({ tx: 0, ty: 0, k: 1.5 })
  const iso3dRef = useRef<HTMLDivElement>(null)
  const iso3dApi = useRef<ReactFlowInstance | null>(null)
  const isoPan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  // The 3D ReactFlow runs `fitView` only once, at init. On first mount its flex
  // container's height often isn't resolved yet, so that fit lands against a
  // wrong/zero size and the scene shows up clipped — until a 2D→3D toggle
  // remounts it against a real size. Watch the (non-transformed) container and
  // re-fit whenever its size settles so the first paint is correct too.
  useEffect(() => {
    if (!threeD) return
    const el = iso3dRef.current

    if (!el) return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        void iso3dApi.current?.fitView({ padding: 0.1 })
      })
    })

    ro.observe(el)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [threeD])
  useEffect(() => {
    if (!threeD) return
    const el = iso3dRef.current

    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : 1 // line-mode → px

      if (e.ctrlKey) {
        // pinch gesture (macOS reports it as ctrl+wheel) → zoom
        const factor = 2 ** (-e.deltaY * unit * 0.02)

        setIso3d((s) => ({ ...s, k: Math.min(3, Math.max(0.2, s.k * factor)) }))
      } else {
        // two-finger scroll → pan, like ReactFlow's panOnScroll
        setIso3d((s) => ({ ...s, tx: s.tx - e.deltaX * unit, ty: s.ty - e.deltaY * unit }))
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })

    return () => el.removeEventListener('wheel', onWheel)
  }, [threeD])

  return { iso3d, setIso3d, iso3dRef, iso3dApi, isoPan }
}
