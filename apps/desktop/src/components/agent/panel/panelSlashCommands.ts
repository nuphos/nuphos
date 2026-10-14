import { useMemo } from 'react'

import { ATLAS_WEB_BASE_URL } from '../../../lib/webBaseUrl'

import type { SlashCommand } from './composerSlashCommands'
import type { PanelViewCtx } from './ctx'

const MODEL_TRIGGER = '[aria-label^="Model settings"]'

/** Opens the model menu of the composer the command was typed in. */
function openModelMenu(editor: HTMLElement) {
  let node = editor.parentElement

  while (node && !node.querySelector(MODEL_TRIGGER)) node = node.parentElement
  node?.querySelector<HTMLElement>(MODEL_TRIGGER)?.click()
}

/**
 * The composer's `/` commands: Codex's most used ones that Nuphos already
 * has a control for, in Codex's order and wording.
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
      { id: 'model', title: 'Model', description: 'Change the model', run: openModelMenu },
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
