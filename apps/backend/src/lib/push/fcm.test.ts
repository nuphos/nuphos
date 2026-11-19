import { expect, test } from 'bun:test'

import { fcmMessage, isDeadFcmToken } from './fcm'

test('FCM data payload preserves guarded routing and lets the app control display', () => {
  const payload = fcmMessage({
    token: 'opaque',
    userId: 'account',
    teamId: 'team',
    sessionId: 'session',
    title: 'Chat',
    body: 'Done',
    badge: 3,
  })

  expect(payload.message.data).toEqual({
    accountId: 'account',
    teamId: 'team',
    sessionId: 'session',
    title: 'Chat',
    body: 'Done',
    badge: '3',
  })
  expect(payload.message).not.toHaveProperty('notification')
  expect(payload.message.android.ttl).toBe('3600s')
})

test('a subtitle follows the title, since Android shows one title line', () => {
  const payload = fcmMessage({
    token: 'opaque',
    userId: 'account',
    teamId: 'team',
    sessionId: 'channel',
    title: 'Ada',
    subtitle: 'Release',
    body: 'Done',
  })

  expect(payload.message.data).toMatchObject({ title: 'Ada · Release', body: 'Done' })
  expect(payload.message.data).not.toHaveProperty('subtitle')
})

test('a Bot push names its face and runtime; other identities add nothing', () => {
  const base = {
    token: 'opaque',
    userId: 'account',
    teamId: 'team',
    sessionId: 'session',
    title: 'Ada',
    body: 'Done',
  }

  expect(
    fcmMessage({ ...base, agentIdentity: { isBot: true, avatar: '07-ada', provider: 'grok' } })
      .message.data,
  ).toMatchObject({ botAvatar: '07-ada', botProvider: 'grok' })
  expect(
    fcmMessage({ ...base, agentIdentity: { isBot: true, avatar: '07-ada' } }).message.data,
  ).not.toHaveProperty('botProvider')
  for (const agentIdentity of [{ isBot: false }, { isBot: true }, undefined]) {
    const data = fcmMessage({ ...base, agentIdentity }).message.data

    expect(data).not.toHaveProperty('botAvatar')
    expect(data).not.toHaveProperty('botProvider')
  }
})

test('only the FCM UNREGISTERED error invalidates the registration', () => {
  const error = (errorCode: string) => ({
    error: {
      details: [
        {
          '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
          errorCode,
        },
      ],
    },
  })

  expect(isDeadFcmToken(error('UNREGISTERED'))).toBe(true)
  expect(isDeadFcmToken(error('INVALID_ARGUMENT'))).toBe(false)
  expect(isDeadFcmToken(error('SENDER_ID_MISMATCH'))).toBe(false)
  expect(isDeadFcmToken(null)).toBe(false)
})
