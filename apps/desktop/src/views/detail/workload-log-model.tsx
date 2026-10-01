import type { RefObject } from 'react'

// Surfaces when the user has scrolled away from the tail — one click jumps
// back and re-enables follow.
export function FollowTailButton({
  stickRef,
  setStickIndicator,
  scrollRef,
  programmaticScrollRef,
}: {
  stickRef: RefObject<boolean>
  setStickIndicator: (v: boolean) => void
  scrollRef: RefObject<HTMLDivElement | null>
  programmaticScrollRef: RefObject<boolean>
}) {
  return (
    <button
      onClick={() => {
        stickRef.current = true
        setStickIndicator(true)
        const el = scrollRef.current

        if (el) {
          programmaticScrollRef.current = true
          el.scrollTop = el.scrollHeight
          requestAnimationFrame(() => {
            programmaticScrollRef.current = false
          })
        }
      }}
      className="px-2 py-1 rounded text-zViolet-accent hover:bg-zGray-800"
    >
      Follow tail
    </button>
  )
}

export function LogStreamStatus({
  previous,
  streaming,
}: {
  previous: boolean
  streaming: boolean
}) {
  return (
    <span className="flex items-center gap-1.5">
      {previous ? (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-zViolet-accent" />
          previous
        </>
      ) : streaming ? (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          streaming
        </>
      ) : (
        <>
          <span className="w-1.5 h-1.5 rounded-full bg-zGray-600" />
          stopped
        </>
      )}
    </span>
  )
}
