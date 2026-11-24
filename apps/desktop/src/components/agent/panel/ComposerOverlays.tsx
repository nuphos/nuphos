import { AgentStatusBanner } from './ReadOnlyNotice'

import type { RuntimeControl } from './RuntimeSelector'
import type { ReactNode } from 'react'

/** Stack the reply and status overlays above the composer instead of letting them overlap. */
export function ComposerOverlays({
  aboveStatus,
  readOnly,
  runtimeControl,
  hero,
  switchAgent,
}: {
  aboveStatus?: ReactNode
  readOnly: boolean
  runtimeControl?: RuntimeControl
  hero: boolean
  switchAgent?: () => void
}) {
  return (
    // In a conversation it takes its own room, so what sits above the composer (the queued
    // messages) stays readable. The hero keeps room for it above the greeting and floats it there.
    <div className={hero ? 'absolute inset-x-0 bottom-full' : 'relative'}>
      {aboveStatus}
      {!readOnly && runtimeControl && (
        <AgentStatusBanner control={runtimeControl} hero={hero} onSwitchAgent={switchAgent} />
      )}
    </div>
  )
}
