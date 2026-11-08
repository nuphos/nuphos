import { useEffect } from 'react'

import type { WorkspaceStore } from './store/workspaceStore'

/** "Make this a Bot" made the Bot's chat: `taskId` is the Task that became the Bot. */
export type TaskBecameBot = { taskId: string; chatId: string; teamId: string }

export const TASK_BECAME_BOT = 'nuphos:task-became-bot'

/** Every pane that showed the Task now shows the Bot's chat; no other pane moves. */
export function showBotChatWhereTaskWas(
  stores: Iterable<WorkspaceStore>,
  { taskId, chatId, teamId }: TaskBecameBot,
) {
  for (const store of stores) {
    const state = store.getState()

    if (!state.mainPageOpen && state.sessionId === taskId) {
      store.actions.selectSession(chatId, { teamId })
    }
  }
}

/** Heard once per window, never once per pane, so one pane cannot move the others. */
export function useTaskBecameBot(stores: ReadonlyMap<string, WorkspaceStore>) {
  useEffect(() => {
    const onTaskBecameBot = (event: Event) =>
      showBotChatWhereTaskWas(stores.values(), (event as CustomEvent<TaskBecameBot>).detail)

    window.addEventListener(TASK_BECAME_BOT, onTaskBecameBot)

    return () => window.removeEventListener(TASK_BECAME_BOT, onTaskBecameBot)
  }, [stores])
}
