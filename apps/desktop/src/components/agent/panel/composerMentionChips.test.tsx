import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'

import { optionChip } from './composerMentionChips'

import type { AgentConversation } from '../../../api'

const dom = new Window({ url: 'https://nuphos.ai/' })

Object.assign(globalThis, { window: dom, document: dom.document, HTMLElement: dom.HTMLElement })

const session = (sessionId: string, title: string) =>
  ({ kind: 'session', session: { sessionId, title } as AgentConversation }) as const

test("a chat's own agent is named, as a person is", () => {
  const chip = optionChip(session('bot-a', 'Release notes'), 'team', ['bot-a'])

  assert.equal(chip.textContent, '@Release notes')
})

test('another Bot is its link chip, not a raw URL or a bare name', () => {
  const chip = optionChip(session('bot-b', 'Sign-in helper'), 'team', ['bot-a'])

  assert.notEqual(chip.textContent, '@Sign-in helper')
  assert.ok(!chip.textContent?.includes('https://'))
  assert.ok(chip.outerHTML.includes('/teams/team/agent/bot-b'))
})
