import { useEffect, useRef, useState } from 'react'

/** Typing shouldn't fire a request per keystroke. */
export function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value.trim()), delayMs)

    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}

/**
 * Infinite scroll for a paged list: hand back the scroller and the sentinel to
 * place at its end, and `loadMore` runs as the sentinel nears view. Nothing is
 * observed once there is no next page, so the last page costs no listener.
 */
export function useSentinelAutoLoad(hasNextPage: boolean, loadMore: () => Promise<void>) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!hasNextPage) return
    const el = sentinelRef.current

    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore()
      },
      { root: scrollRef.current, rootMargin: '200px' },
    )

    observer.observe(el)

    return () => observer.disconnect()
  }, [hasNextPage, loadMore])

  return { scrollRef, sentinelRef }
}

/**
 * The latest value of a callback, readable from an effect without listing it
 * as a dependency. Lets a caller pass an inline function without its changing
 * identity re-running the fetch that reports to it.
 */
export function useEventCallbackRef<T>(callback: T) {
  const ref = useRef(callback)

  useEffect(() => {
    ref.current = callback
  }, [callback])

  return ref
}
