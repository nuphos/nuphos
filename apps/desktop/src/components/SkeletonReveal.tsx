import clsx from 'clsx'
import { useLayoutEffect, useRef } from 'react'

import type { ReactNode } from 'react'

/**
 * transitions.dev "Skeleton loader and reveal": the skeleton pulses until
 * `ready`, then both layers cross-fade with a cross-blur. The snippet stacks
 * both layers absolutely; here whichever layer is showing stays in flow so the
 * wrapper keeps its height, and the other one overlays it.
 */
export function SkeletonReveal({
  ready,
  skeleton,
  children,
}: {
  ready: boolean
  skeleton: ReactNode
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const skeletonLayer = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const skel = root.current
    const layer = skeletonLayer.current

    if (!skel || !layer) return
    if (ready) {
      layer.getBoundingClientRect()
      skel.classList.add('is-revealed')

      return
    }
    skel.classList.add('is-resetting')
    skel.classList.remove('is-revealed')
    layer.classList.remove('is-pulsing')
    layer.getBoundingClientRect()
    skel.classList.remove('is-resetting')
    layer.classList.add('is-pulsing')
  }, [ready])

  return (
    <div ref={root} className="t-skel" data-state={ready ? 'ready' : 'loading'}>
      <div
        ref={skeletonLayer}
        aria-hidden={ready}
        className={clsx(
          't-skel-skeleton is-pulsing',
          !ready && '!relative',
          ready && 'pointer-events-none',
        )}
      >
        {skeleton}
      </div>
      <div className={clsx('t-skel-content', ready && '!relative')}>{ready && children}</div>
    </div>
  )
}
