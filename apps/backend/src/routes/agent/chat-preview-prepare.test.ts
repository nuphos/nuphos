// Enter the routes/agent module graph through its barrel first, so the
// constants ↔ run-pump-helpers cycle initializes in production order.
import '@/routes/agent'

import { expect, test } from 'bun:test'

import { lastUserMessageText, resumeMessage } from './chat-preview-prepare'

import type { UIMessage } from 'ai'

const msg = (role: 'user' | 'assistant', parts: UIMessage['parts']): UIMessage => ({
  id: '1',
  role,
  parts,
})

test('returns the single text part', () => {
  expect(lastUserMessageText([msg('user', [{ type: 'text', text: 'hello' }])])).toBe('hello')
})

test('joins multiple text parts (attachment instruction preserved)', () => {
  const messages = [
    msg('user', [
      { type: 'text', text: 'summarize the report' },
      { type: 'text', text: '[transfer group abc123]' },
    ]),
  ]

  expect(lastUserMessageText(messages)).toBe('summarize the report\n\n[transfer group abc123]')
})

test('skips non-text parts', () => {
  const messages = [
    msg('user', [
      { type: 'text', text: 'look at this' },
      { type: 'step-start' } as unknown as UIMessage['parts'][0],
      { type: 'text', text: '[attachment]' },
    ]),
  ]

  expect(lastUserMessageText(messages)).toBe('look at this\n\n[attachment]')
})

test('returns empty string when no user message', () => {
  expect(lastUserMessageText([msg('assistant', [{ type: 'text', text: 'hi' }])])).toBe('')
})

test('picks the last user message', () => {
  const messages = [
    msg('user', [{ type: 'text', text: 'first' }]),
    msg('assistant', [{ type: 'text', text: 'reply' }]),
    msg('user', [{ type: 'text', text: 'second' }]),
  ]

  expect(lastUserMessageText(messages)).toBe('second')
})

test('a new message is prompted as itself', () => {
  expect(resumeMessage(undefined)).toBeNull()
})

test('a resume asks the runtime to carry on rather than replaying the task', () => {
  // The native session still holds the context; replaying the user's message
  // would make it redo work it has already done.
  expect(resumeMessage({ reason: 'permission-decision' })).toContain('permission proposal')
  expect(resumeMessage({ reason: 'client-tool' })).toContain('Nuphos Desktop')
  expect(resumeMessage({})).toContain('Carry on')
  for (const reason of ['permission-decision', 'approval-decision', 'client-tool'] as const)
    expect(resumeMessage({ reason })).not.toContain('undefined')
})

const screenshot = {
  type: 'file',
  mediaType: 'image/png',
  url: 'data:image/png;base64,aGVsbG8=',
  filename: 'screenshot.png',
  attachmentId: 'att_test',
}

test('structured attachments never become transfer instructions in message text', () => {
  const text = lastUserMessageText([msg('user', [screenshot] as UIMessage['parts'])])

  expect(text).toBe('')
  expect(text).not.toContain('base64')
})
