import { useEffect, useState } from 'react'

import { formatAge } from '../utils'

// Shared 1-Hz subscription so every <Age> cell re-renders in lockstep using
// a single setInterval, instead of one timer per row.
const subs = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function fire() {
  for (const cb of subs) cb()
}

function ensureTimer() {
  if (timer) return
  timer = setInterval(fire, 1000)
}

function maybeStopTimer() {
  if (subs.size > 0 || !timer) return
  clearInterval(timer)
  timer = null
}

function useSecondTick() {
  const [, setTick] = useState(0)

  useEffect(() => {
    const cb = () => setTick((t) => (t + 1) & 0xffff)

    subs.add(cb)
    ensureTimer()

    return () => {
      subs.delete(cb)
      maybeStopTimer()
    }
  }, [])
}

export function Age({ value }: { value: string | null | undefined }) {
  useSecondTick()

  return <>{formatAge(value ?? null)}</>
}
