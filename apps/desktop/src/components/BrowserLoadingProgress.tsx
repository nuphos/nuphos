import { useEffect, useRef, useState } from 'react'

/** Webviews report load lifecycle, not byte progress; stop short until completion. */
export function BrowserLoadingProgress({ loading, failed }: { loading: boolean; failed: boolean }) {
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (loading) {
      started.current = true
      const frame = window.requestAnimationFrame(() => {
        setProgress(0.08)
        setVisible(true)
      })
      const timer = window.setInterval(() => {
        setProgress((value) => Math.min(0.92, value + (0.94 - value) * 0.12))
      }, 300)

      return () => {
        window.cancelAnimationFrame(frame)
        window.clearInterval(timer)
      }
    }
    if (!started.current) return
    const frame = window.requestAnimationFrame(() => {
      if (!failed) setProgress(1)
    })
    const timer = window.setTimeout(() => setVisible(false), failed ? 0 : 350)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [loading, failed])

  return (
    <div
      role={loading ? 'progressbar' : undefined}
      aria-label={loading ? 'Loading page' : undefined}
      aria-hidden={!visible}
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden transition-opacity duration-150 motion-reduce:transition-none"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div
        className="h-full w-full origin-left bg-zViolet-500 transition-transform duration-300 ease-out motion-reduce:transition-none"
        style={{ transform: `scaleX(${String(progress)})` }}
      />
    </div>
  )
}
