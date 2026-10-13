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
