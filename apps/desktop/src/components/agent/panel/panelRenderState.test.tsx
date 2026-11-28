import assert from 'node:assert/strict'

import { test } from 'bun:test'

import { computePanelRenderState } from './panelRenderState'

import type { CredentialSelectorControl } from './credentialSections'

const options = { aws: [], gcp: [], linode: [] } as unknown as CredentialSelectorControl['options']

function noop() {
  // Nothing is saved, loaded or dropped in this test.
}

function render(credentialSource?: { sessionId: string }) {
  return computePanelRenderState({
    activeId: 'task',
    activeTab: {
      sessionId: 'task',
      messages: [{ id: 'm' }],
      credentialOptionsSeen: undefined,
      ...(credentialSource ? { credentialSource } : {}),
    },
    conversationDropRef: { current: null },
    credentialOptions: options,
    credentialsRefreshing: false,
    credentialsSaving: false,
    dragDepthRef: { current: 0 },
    effectiveCredentialAccess: {},
    homeDropRef: { current: null },
    openingConversation: null,
    pendingPrompt: null,
    refreshCredentialOptions: noop,
    visible: true,
    sessionIdProp: undefined,
    setDraggingFiles: noop,
    teamId: 'team',
    updateCredentialSelection: noop,
    variant: 'page',
  } as unknown as Parameters<typeof computePanelRenderState>[0])
}

test("a Task under a Bot has no picker of its own, but its Connect cards still select the Bot's", () => {
  const task = render({ sessionId: 'bot' })

  assert.equal(task.visibleConversationCredentialSelector, undefined)
  assert.ok(task.conversationCredentialSelector)
})

test('any other conversation shows the same selection in its picker and its cards', () => {
  const chat = render()

  assert.ok(chat.visibleConversationCredentialSelector)
  assert.ok(chat.conversationCredentialSelector)
})
