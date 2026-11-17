import { useStableCallback } from '../../hooks/useStableCallback'
import { openBotChannel } from '../channels/botChannel'

import { nextBotAfterArchive } from './archiveBotSelection'
import { withChatSections } from './chat-sections'

import type { Item } from './types'

type ArchiveFocus = {
  teamId: string
  selectedId: string | null
  enabled: boolean
  onArchived?: (id: string) => void
  onSelect: (key: string) => void
  items: Item[]
  archiving: ReadonlySet<string>
}

export function useBotArchiveFocus(current: () => ArchiveFocus) {
  return useStableCallback((sessionId: string) => {
    const { teamId, selectedId, enabled, onArchived, onSelect, items, archiving } = current()
    const sections = withChatSections([{ title: 'Agents', items }], (id) =>
      openBotChannel(teamId, id, onSelect),
    )
    const bots = sections.find((section) => section.title === 'Channels')?.items ?? []
    const next = enabled ? nextBotAfterArchive(bots, selectedId, sessionId, archiving) : undefined

    onArchived?.(sessionId)
    if (next?.onActivate) next.onActivate(false)
    else if (next) onSelect(next.key)
  })
}
