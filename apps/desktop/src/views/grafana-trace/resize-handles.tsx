import { clamp } from './format'

export function ColumnResizeHandle({
  containerRef,
  valuePct,
  onChange,
  minPct,
  maxPct,
  label,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  valuePct: number
  onChange: (value: number) => void
  minPct: number
  maxPct: number
  label: string
}) {
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    const containerBox = containerRef.current?.getBoundingClientRect()

    if (!containerBox) return
    const containerWidth = containerBox.width
    const startX = e.clientX
    const startPct = valuePct

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    let raf = 0
    let lastX = startX

    function apply() {
      raf = 0
      const dxPct = ((lastX - startX) / containerWidth) * 100

      onChange(clamp(startPct + dxPct, minPct, maxPct))
    }

    function move(ev: PointerEvent) {
      ev.preventDefault()
      lastX = ev.clientX
      if (raf === 0) raf = requestAnimationFrame(apply)
    }

    function up() {
      if (raf !== 0) cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div
      role="separator"
      aria-label={label}
      onPointerDown={startResize}
      style={{ touchAction: 'none' }}
      className="group relative z-20 w-1.5 flex-shrink-0 cursor-col-resize bg-zGray-950 hover:bg-zGray-900"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zGray-800 group-hover:w-0.5 group-hover:bg-zViolet-accent" />
    </div>
  )
}

export function InlineColumnResizeHandle({
  containerRef,
  valuePct,
  onChange,
  minPct,
  maxPct,
  label,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  valuePct: number
  onChange: (value: number) => void
  minPct: number
  maxPct: number
  label: string
}) {
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    const containerBox = containerRef.current?.getBoundingClientRect()

    if (!containerBox) return
    const containerLeft = containerBox.left
    const containerWidth = containerBox.width

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function move(ev: PointerEvent) {
      ev.preventDefault()
      const pct = ((ev.clientX - containerLeft) / containerWidth) * 100

      onChange(clamp(pct, minPct, maxPct))
    }

    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div
      role="separator"
      aria-label={label}
      onPointerDown={startResize}
      style={{ left: `${String(valuePct)}%`, touchAction: 'none' }}
      className="absolute inset-y-0 z-30 w-3 -translate-x-1/2 cursor-col-resize group"
    >
      <div className="mx-auto h-full w-px bg-zGray-800 group-hover:w-0.5 group-hover:bg-zViolet-accent" />
    </div>
  )
}
