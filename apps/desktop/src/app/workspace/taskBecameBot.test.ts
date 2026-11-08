import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createWorkspaceState } from './store/workspaceState.ts'
import { createWorkspaceStore } from './store/workspaceStore.ts'
import { showBotChatWhereTaskWas } from './taskBecameBot.ts'

const pane = (sessionId: string | null, mainPageOpen = false) =>
  createWorkspaceStore({
    ...createWorkspaceState(),
    teamsKnown: true,
    sessionId,
    mainPageOpen,
  })

test('making a Bot moves only the panes that showed its Task', () => {
  // Seven split panes, each on its own Task; the Task in pane 3 also shows in pane 6.
  const panes = ['t1', 't2', 'bot', 't4', 't5', 'bot', 't7'].map((id) => pane(id))

  showBotChatWhereTaskWas(panes, { taskId: 'bot', chatId: 'chat', teamId: 'team' })

  assert.deepEqual(
    panes.map((store) => store.getState().sessionId),
    ['t1', 't2', 'chat', 't4', 't5', 'chat', 't7'],
  )
})

test('making a Bot of a Task open in no pane moves no pane', () => {
  const panes = [pane('t1'), pane(null), pane('bot', true)]
  const before = panes.map((store) => store.getState())

  showBotChatWhereTaskWas(panes, { taskId: 'bot', chatId: 'chat', teamId: 'team' })

  assert.deepEqual(
    panes.map((store) => store.getState()),
    before,
  )
})
