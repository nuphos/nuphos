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
    <div className="absolute inset-x-0 bottom-full">
      {aboveStatus}
      {!readOnly && runtimeControl && (
        <AgentStatusBanner control={runtimeControl} hero={hero} onSwitchAgent={switchAgent} />
      )}
    </div>
  )
}
