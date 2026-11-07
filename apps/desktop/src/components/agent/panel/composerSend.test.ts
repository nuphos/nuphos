import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isSendEnter, sendWithMentionInvites, settleSend, submitDraft } from './composerSend.ts'

import type { SendResult } from './composerSend.ts'
import type { AgentMessageMention } from '../../../api/agent-types'

/** A composer holding one draft, cleared the way the real one is. */
function composer(text = 'deploy the fix', filePaths: string[] = []) {
  let editor = text
  let files = filePaths
  // One ref for the composer, as a useRef is: it spans submits.
  const pending = { current: false }

  return {
    cleared: 0,
    files: () => files,
    text: () => editor,
    // Newer typing, as the editor would hold it, and a newer attachment list.
    type: (next: string) => {
      editor = next
    },
    attach: (next: string[]) => {
      files = next
    },
    /** Submits as `useComposerActions.submit` does: the draft sent is captured first. */
    submit(send: () => SendResult) {
      const sent = editor.trim()
      const sentPaths = files

      submitDraft(send, {
        pending,
        clear: () => {
          this.cleared++
          editor = ''
          files = []
        },
        unchanged: () => editor.trim() === sent && files === sentPaths,
      })
    },
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

const mentions: AgentMessageMention[] = [
  { id: 'user-2', displayName: 'Ada' },
  { id: 'user-3', displayName: 'Grace' },
]

test('a send the composer accepted clears it', async () => {
  const box = composer()

  box.submit(() => Promise.resolve(true))
  await settle()

  assert.equal(box.cleared, 1)
  assert.equal(box.text(), '')
  assert.deepEqual(box.files(), [])
})

test('an immediate refusal keeps the text and its attachments', async () => {
  const box = composer('no runtime', ['/Users/me/a.log'])

  box.submit(() => Promise.resolve(false))
  await settle()

  assert.equal(box.cleared, 0)
  assert.equal(box.text(), 'no runtime')
  assert.deepEqual(box.files(), ['/Users/me/a.log'])
})

test('a late acceptance clears the box without waiting for the answer', async () => {
  const box = composer()
  const answer = Promise.withResolvers<boolean>()

  box.submit(() => answer.promise)
  // The answer has not come back yet, so nothing has been cleared.
  assert.equal(box.cleared, 0)
  answer.resolve(true)
  await settle()

  assert.equal(box.cleared, 1)
})

test('a late acceptance leaves newer typing alone', async () => {
  const box = composer('first draft')
  const answer = Promise.withResolvers<boolean>()

  box.submit(() => answer.promise)
  box.type('a second, different thought')
  answer.resolve(true)
  await settle()

  assert.equal(box.cleared, 0)
  assert.equal(box.text(), 'a second, different thought')
})

test('a late acceptance leaves attachments added while it was pending alone', async () => {
  const box = composer('with a file', ['/Users/me/a.log'])
  const answer = Promise.withResolvers<boolean>()

  box.submit(() => answer.promise)
  box.attach(['/Users/me/a.log', '/Users/me/b.log'])
  answer.resolve(true)
  await settle()

  assert.equal(box.cleared, 0)
  assert.deepEqual(box.files(), ['/Users/me/a.log', '/Users/me/b.log'])
})

test('a late refusal keeps the draft', async () => {
  const box = composer('sent into a dead runtime', ['/Users/me/a.log'])
  const answer = Promise.withResolvers<boolean>()

  box.submit(() => answer.promise)
  answer.resolve(false)
  await settle()

  assert.equal(box.cleared, 0)
  assert.equal(box.text(), 'sent into a dead runtime')
  assert.deepEqual(box.files(), ['/Users/me/a.log'])
})

test('a send that rejects keeps the draft and is never retried', async () => {
  const box = composer()
  let sends = 0

  box.submit(() => {
    sends++

    return Promise.reject(new Error('offline'))
  })
  await settle()

  assert.equal(box.cleared, 0)
  assert.equal(box.text(), 'deploy the fix')
  assert.equal(sends, 1)
})

test('a second Enter while the first send is unanswered does not send twice', async () => {
  const box = composer()
  const answer = Promise.withResolvers<boolean>()
  let sends = 0

  const send = () => {
    sends++

    return answer.promise
  }

  box.submit(send)
  box.submit(send)
  box.submit(send)
  assert.equal(sends, 1)

  // Once it answers, the next Enter goes out: the box is not stuck.
  answer.resolve(true)
  await settle()
  box.submit(send)
  assert.equal(sends, 2)
})

test('a refused send can be sent again after the answer comes back', async () => {
  const box = composer()
  const answer = Promise.withResolvers<boolean>()
  let sends = 0

  box.submit(() => {
    sends++

    return answer.promise
  })
  answer.resolve(false)
  await settle()
  box.submit(() => {
    sends++

    return Promise.resolve(true)
  })
  await settle()

  assert.equal(sends, 2)
  assert.equal(box.cleared, 1)
})

test('settleSend runs the branch that matches the answer, and refusal on a failure', async () => {
  const ran: string[] = []

  settleSend(Promise.resolve(true), {
    accepted: () => ran.push('accepted'),
    refused: () => ran.push('refused'),
  })
  settleSend(Promise.resolve(false), {
    accepted: () => ran.push('accepted'),
    refused: () => ran.push('refused'),
  })
  settleSend(Promise.reject(new Error('offline')), {
    accepted: () => ran.push('accepted'),
    refused: () => ran.push('refused'),
  })
  await settle()

  assert.deepEqual(ran, ['accepted', 'refused', 'refused'])
})

test('settleSend needs no branch for a side nobody asked about', async () => {
  assert.doesNotThrow(() => settleSend(Promise.resolve(true), {}))
  assert.doesNotThrow(() => settleSend(Promise.reject(new Error('offline')), {}))
  await settle()
})

test('Enter sends, and nothing else does', () => {
  const open = { composing: false, readOnly: false }
  const enter = { key: 'Enter', shiftKey: false }

  assert.equal(isSendEnter(enter, open), true)
  assert.equal(isSendEnter({ ...enter, shiftKey: true }, open), false)
  assert.equal(isSendEnter({ key: 'NumpadEnter', shiftKey: false }, open), false)
  assert.equal(isSendEnter(enter, { composing: false, readOnly: true }), false)
})

test('an input method mid-composition keeps Enter for its own candidate list', () => {
  const enter = { key: 'Enter', shiftKey: false }
  const open = { composing: false, readOnly: false }

  // The editor tracks composition itself; some IMEs only report it on the event.
  assert.equal(isSendEnter(enter, { ...open, composing: true }), false)
  assert.equal(isSendEnter({ ...enter, isComposing: true }, open), false)
  // The legacy signal: 229 says "still composing" even when the flags are false.
  assert.equal(isSendEnter({ ...enter, keyCode: 229 }, open), false)
  assert.equal(isSendEnter({ ...enter, keyCode: 13 }, open), true)
})

test('teammates are offered an invite only for a message that went out', async () => {
  const offered: string[][] = []
  let sends = 0
  const send = () => {
    sends++

    return Promise.resolve(true)
  }

  const result = sendWithMentionInvites(send, 'ping @Ada', [], mentions, (ids) => offered.push(ids))

  assert.equal(await result, true)
  assert.equal(sends, 1)
  assert.deepEqual(offered, [['user-2', 'user-3']])
})

test('a refused send offers nobody an invite and still reports the refusal', async () => {
  const offered: string[][] = []
  const result = sendWithMentionInvites(
    () => Promise.resolve(false),
    'ping @Ada',
    [],
    mentions,
    (ids) => offered.push(ids),
  )

  assert.equal(await result, false)
  await settle()
  // The draft is still in the composer: nobody has been addressed yet.
  assert.deepEqual(offered, [])
})

test('a send that failed offers nobody an invite', async () => {
  const offered: string[][] = []

  const result = sendWithMentionInvites(
    () => Promise.reject(new Error('offline')),
    'ping @Ada',
    ['/Users/me/a.log'],
    mentions,
    (ids) => offered.push(ids),
  )

  await assert.rejects(result)
  await settle()
  assert.deepEqual(offered, [])
})

test('a late acceptance still offers the invite, once the send owns the message', async () => {
  const offered: string[][] = []
  const answer = Promise.withResolvers<boolean>()
  const result = sendWithMentionInvites(
    () => answer.promise,
    'ping @Ada',
    [],
    mentions,
    (ids) => offered.push(ids),
  )

  assert.deepEqual(offered, [])
  answer.resolve(true)
  assert.equal(await result, true)
  assert.deepEqual(offered, [['user-2', 'user-3']])
})

test('the text, attachments and mentions go through to the send untouched', () => {
  const calls: unknown[][] = []

  sendWithMentionInvites(
    (...args) => {
      calls.push(args)

      return Promise.resolve(false)
    },
    'ping @Ada',
    ['/Users/me/a.log'],
    mentions,
    () => {},
  )

  assert.deepEqual(calls, [['ping @Ada', ['/Users/me/a.log'], mentions]])
})
