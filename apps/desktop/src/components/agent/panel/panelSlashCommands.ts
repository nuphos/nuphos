import { useMemo } from 'react'

import { ATLAS_WEB_BASE_URL } from '../../../lib/webBaseUrl'

import type { SlashCommand } from './composerSlashCommands'
import type { PanelViewCtx } from './ctx'

/**
 * The panel's `/` actions: Codex's most used ones that Nuphos already has a
 * control for, in Codex's order and wording. Each composer adds Model itself
 * when it has a model control.
 */
export function usePanelSlashCommands(c: PanelViewCtx): SlashCommand[] {
  const { activeTab, forkConversation, onOpenNuphosLink, startNewChat, teamId } = c
  const forkableSessionId = activeTab && !activeTab.unsaved ? activeTab.sessionId : undefined

  return useMemo(
    () => [
      { id: 'new', title: 'New chat', description: 'Start a new chat', run: startNewChat },
      ...(forkableSessionId
        ? [
            {
              id: 'fork',
              title: 'Fork chat',
              description: 'Fork this chat',
              run: () => void forkConversation(forkableSessionId),
            },
          ]
        : []),
      ...(teamId && onOpenNuphosLink
        ? [
            {
              id: 'memories',
              title: 'Memories',
              description: "Open your team's memories",
              run: () => {
                onOpenNuphosLink(
                  `${ATLAS_WEB_BASE_URL}/teams/${encodeURIComponent(teamId)}/agent/memories`,
                )
              },
            },
          ]
        : []),
    ],
    [forkConversation, forkableSessionId, onOpenNuphosLink, startNewChat, teamId],
  )
}
