import { useMemo } from 'react'

import { t } from '../../../i18n/index.ts'
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
      { id: 'new', title: t('New agent'), description: t('Start a new agent'), run: startNewChat },
      ...(forkableSessionId
        ? [
            {
              id: 'fork',
              title: t('Fork agent'),
              description: t('Fork this agent'),
              run: () => void forkConversation(forkableSessionId),
            },
          ]
        : []),
      ...(teamId && onOpenNuphosLink
        ? [
            {
              id: 'memories',
              title: t('Memories'),
              description: t("Open your team's memories"),
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
