import { ThreadBadge } from './ThreadBadge'
import { isThreadBadgePart } from './threadBadges'
import { TriggerCard } from './TriggerCard'
import { isTriggerCardPart } from './triggerCards'

import type { OpenLink } from './LocalUrlChip'
import type { ToolPart } from './parts'
import type { ReactElement } from 'react'

/** Tool calls the transcript shows as a card of their own instead of a tool row. */
export function renderCardToolPart(
  part: ToolPart,
  key: string,
  teamId: string | undefined,
  onOpen: OpenLink | undefined,
): ReactElement | null {
  if (isThreadBadgePart(part)) {
    return <ThreadBadge key={key} part={part} teamId={teamId} onOpen={onOpen} />
  }
  if (isTriggerCardPart(part)) {
    return <TriggerCard key={key} part={part} teamId={teamId} onOpen={onOpen} />
  }

  return null
}
