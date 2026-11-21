import { AgentStatusBanner } from './ReadOnlyNotice'

import type { RuntimeControl } from './RuntimeSelector'
import type { ReactNode } from 'react'

/** Stack the reply and status overlays above the composer instead of letting them overlap. */
export function ComposerOverlays({
  above,
  control,
  hero,
  onSwitchAgent,
}: {
  above?: ReactNode
  control?: RuntimeControl
  hero: boolean
  onSwitchAgent?: () => void
}) {
  return (
    <div className="absolute inset-x-0 bottom-full">
      {above}
      {control && <AgentStatusBanner control={control} hero={hero} onSwitchAgent={onSwitchAgent} />}
    </div>
  )
}
