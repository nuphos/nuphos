import { beforeEach, describe, expect, test } from 'bun:test'

import { createComputerAlerts } from './computer-alerts'

import type { ApnsRequest } from './apns'
import type { PushDevice } from './devices'

const phone = (token: string, extra: Partial<PushDevice> = {}): PushDevice => ({
  userId: 'user-1',
  token,
  deviceId: `phone-${token}`,
  platform: 'ios',
  environment: 'sandbox',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...extra,
})

let phones: PushDevice[]
let sent: ApnsRequest[]

const alerts = () =>
  createComputerAlerts({
    credentials: () => ({
      keyId: 'k',
      teamId: 't',
      privateKey: 'p',
      bundleId: 'ai.nuphos.ios',
      environment: 'sandbox',
    }),
    send: async (_credentials, request) => {
      sent.push(request)

      return { status: 200 }
    },
    devices: {
      register: async () => {},
      unregister: async () => {},
      listForUser: async () => phones,
      removeToken: async () => {},
    },
    now: () => 0,
  })

const change = (online: boolean) => ({
  deviceId: 'mac-1',
  online,
  title: online ? 'MacBook Pro is back online' : 'MacBook Pro is offline',
  body: 'Agents',
})

beforeEach(() => {
  phones = [phone('aa'), phone('bb')]
  sent = []
})

describe('computer alerts', () => {
  test('open the app, and back online replaces the offline alert', async () => {
    const alert = alerts()

    await alert('user-1', change(false))
    await alert('user-1', change(true))

    expect(sent).toHaveLength(4)
    expect(sent[0]?.payload).toEqual({
      aps: { alert: { title: 'MacBook Pro is offline', body: 'Agents' }, sound: 'default' },
      accountId: 'user-1',
    })
    expect(sent.map((request) => request.collapseId)).toEqual(Array(4).fill('computer:mac-1'))
  })

  test('sends FCM only to opted-in Android devices on the configured project', async () => {
    const android = (token: string, extra: Partial<PushDevice> = {}) =>
      phone(token, {
        platform: 'android',
        environment: 'production',
        projectId: 'configured',
        ...extra,
      })

    phones = [
      android('enabled', { computerAlerts: true }),
      android('disabled', { computerAlerts: false }),
      android('legacy'),
      android('wrong-project', { computerAlerts: true, projectId: 'other' }),
    ]
    const delivered: string[] = []
    const removed: string[] = []
    const alert = createComputerAlerts({
      credentials: () => null,
      send: async () => {
        throw new Error('Unexpected APNs send')
      },
      fcmProject: () => 'configured',
      sendFcm: async (project, token, id, event) => {
        expect([project, id, event.deviceId]).toEqual(['configured', 'user-1', 'mac-1'])
        delivered.push(token)

        return { status: 404, deadToken: true }
      },
      devices: {
        register: async () => {},
        unregister: async () => {},
        listForUser: async () => phones,
        removeToken: async (token) => {
          removed.push(token)
        },
      },
      now: () => 0,
    })

    await alert('user-1', change(false))
    expect(delivered).toEqual(['enabled'])
    expect(removed).toEqual(['enabled'])
  })

  test('skip phones that turned them off, and Android', async () => {
    phones = [
      phone('aa', { computerAlerts: false }),
      phone('bb'),
      phone('cc', { platform: 'android' }),
    ]
    await alerts()('user-1', change(false))

    expect(sent.map((request) => request.deviceToken)).toEqual(['bb'])
  })
})
