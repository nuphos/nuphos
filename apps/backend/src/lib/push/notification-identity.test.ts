import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BOT_AVATARS } from '../agent/bot-avatars.ts'

import { notificationIdentity } from './notification-identity.ts'

void test('only the original Bot session supplies its chosen face and known runtime', () => {
  for (const provider of ['codex', 'grok', 'claude-code', 'antigravity', 'opencode']) {
    const identity = notificationIdentity({ avatar: '05-rembrandt', agentRuntime: provider })

    assert.deepEqual(identity, { isBot: true, avatar: '05-rembrandt', provider })
    assert.ok(Buffer.byteLength(JSON.stringify({ agentIdentity: identity })) < 150)
  }
  for (const agentRuntime of [undefined, null, '', 'future-provider']) {
    assert.deepEqual(notificationIdentity({ avatar: '07-ada', agentRuntime }), {
      isBot: true,
      avatar: '07-ada',
    })
  }
})

void test('Tasks, null faces and human/group channels never acquire a persona', () => {
  for (const session of [
    {},
    { avatar: null },
    { agentRuntime: 'codex' },
    { kind: 'channel', avatar: '07-ada', agentRuntime: 'grok' },
  ]) {
    assert.deepEqual(notificationIdentity(session), { isBot: false })
  }
})

void test('unknown catalog entries cannot inflate or expose arbitrary push metadata', () => {
  assert.deepEqual(
    notificationIdentity({ avatar: `future-${'x'.repeat(5000)}`, agentRuntime: 'codex' }),
    { isBot: true, provider: 'codex' },
  )
  for (const avatar of BOT_AVATARS) {
    assert.ok(
      Buffer.byteLength(
        JSON.stringify({
          agentIdentity: notificationIdentity({ avatar, agentRuntime: 'antigravity' }),
        }),
      ) < 150,
    )
  }
})

void test('a Task with a persisted avatar is canonically a converted Bot; clearing it restores a Task', () => {
  const session: { avatar?: string | null; agentRuntime: string } = { agentRuntime: 'codex' }

  assert.deepEqual(notificationIdentity(session), { isBot: false })
  session.avatar = '02-leonardo'
  assert.deepEqual(notificationIdentity(session), {
    isBot: true,
    avatar: '02-leonardo',
    provider: 'codex',
  })
  delete session.avatar
  assert.deepEqual(notificationIdentity(session), { isBot: false })
  session.avatar = null
  assert.deepEqual(notificationIdentity(session), { isBot: false })
})

void test('custom/unknown stored avatars classify as Bots but cannot fabricate a notification face', () => {
  assert.deepEqual(notificationIdentity({ avatar: '99-custom', agentRuntime: 'grok' }), {
    isBot: true,
    provider: 'grok',
  })
  assert.deepEqual(notificationIdentity({ avatar: '' }), { isBot: true })
})
