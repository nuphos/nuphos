import { animate, useReducedMotion } from 'framer-motion'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { t } from '../../../i18n'

import { ComputerCard } from './ComputerCard'
import { BOX_MODEL, FLIGHT } from './runtimeStatuses'

/**
 * The Box, once claimed, beside this computer: it flies from where the dialog showed it
 * (`from`) to its place, then its name and state show, and `onLanded` hears it. Only a
 * picture of it, with no runtimes card: once it stands there the page shows just the two.
 */
export function ArrivingBox({ from, onLanded }: { from: DOMRect | null; onLanded: () => void }) {
  const reduce = useReducedMotion() ?? false
  const art = useRef<HTMLDivElement>(null)
  const [landed, setLanded] = useState(reduce || !from)
  const heard = useRef(onLanded)

  useEffect(() => {
    heard.current = onLanded
  })
  useEffect(() => {
    if (landed) heard.current()
  }, [landed])

  // Measured before the first paint, so it is first seen where the dialog left it.
  useLayoutEffect(() => {
    const node = art.current

    if (!node || !from || reduce) return
    const to = node.getBoundingClientRect()
    const flight = animate(
      node,
      {
        x: [from.left - to.left, 0],
        y: [from.top - to.top, 0],
        scale: [from.width / to.width, 1],
      },
      FLIGHT,
    )

    void flight.then(() => setLanded(true))

    return () => flight.stop()
  }, [from, reduce])

  return (
    <div className="shrink-0">
      <ComputerCard
        model={BOX_MODEL}
        name="InstaBox"
        mark={
          <span
            aria-hidden
            className="size-3.5 shrink-0 bg-current [mask:url(/instabox-mark.svg)_center/contain_no-repeat]"
          />
        }
        status={t('Online')}
        detail="Linux"
        facing
        artRef={art}
        artStyle={{ transformOrigin: '0 0' }}
        revealed={landed}
      />
    </div>
  )
}
