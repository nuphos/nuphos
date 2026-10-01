import { useEffect, useRef, useState } from 'react'

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current

    if (!el) return
    const update = () => {
      // A keep-alive tab hidden with display:none measures 0×0; keeping the
      // last real size avoids relaying out the whole grid on hide and show.
      if (el.clientWidth === 0 && el.clientHeight === 0) return
      setSize((prev) =>
        prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      )
    }

    update()
    const observer = new ResizeObserver(update)

    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  return { ref, ...size }
}
