import assert from 'node:assert/strict'

import { mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import type { SessionInputRequest } from '../agent/summary/sessionInputRequests'

type PanelProps = { onSelectRequest?: (request: SessionInputRequest) => void }

let panel: PanelProps | undefined

mock.module('../agent/summary/ChatSummaryPanel', () => ({
  ChatSummaryPanel: (props: PanelProps) => {
    panel = props

    return null
  },
}))
mock.module('../agent/summary/useSessionInputRequests', () => ({
  useSessionInputRequests: () => ({ requests: [], loaded: true, failed: false }),
}))
mock.module('../sidebar/agentSessions', () => ({
  useAgentSessions: () => ({ data: [] }),
  setChatInstructions: async () => {},
}))
mock.module('../agent/panel/sessionBypass', () => ({ useBypassControl: () => {} }))
const picked: [string, string][] = []

mock.module('../../views/inbox/inboxSelection', () => ({
  selectInboxQuestion: (teamId: string, id: string) => picked.push([teamId, id]),
}))

const modes: [string, number][] = []

mock.module('../sidebar/sidebarModeStore', () => ({
  setSidebarMode: (teamId: string, page: number) => modes.push([teamId, page]),
}))

const { BotDetailsPanel } = await import('./BotDetails')

// #4069: "Needs your input" in a Bot's details answered a question inside the
// panel; it opens the Inbox page on that question instead.
test("a question under the Bot details' Needs your input opens the Inbox on it", () => {
  const opened: string[] = []

  renderToStaticMarkup(
    <BotDetailsPanel
      teamId="team-a"
      bot="bot-1"
      title="Scribe"
      agents={[]}
      loading={false}
      owned
      botState={undefined}
      onEdited={() => {}}
      onOpenSession={() => assert.fail('the question must not open a session')}
      onOpenLink={(href) => opened.push(href)}
      credentials={undefined}
    />,
  )
  assert.ok(panel?.onSelectRequest, 'the Bot details pick where a question opens')
  panel.onSelectRequest({
    sessionId: 'task-1',
    inputRequest: { id: 'q1', question: 'Which region?' },
  } as SessionInputRequest)

  assert.deepEqual(picked, [['team-a', 'q1']])
  // The sidebar turns to the Inbox list (page 2), as the Inbox tab would.
  assert.deepEqual(modes, [['team-a', 2]])
  assert.deepEqual(opened, ['/teams/team-a/inbox'])
})
