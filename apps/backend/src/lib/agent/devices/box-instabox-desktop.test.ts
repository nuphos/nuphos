import { InstaboxAuthError, Sandbox } from '@insforge/instabox-sdk'
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

import { config } from '@/config'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstaboxLimit } from '@/lib/test/doubles/box-instabox-limit'

import { boxVncUpstream, startBoxDesktop } from './box-instabox'
import * as accountModule from './box-instabox-account'
import { boxVncRelay } from './box-instabox-vnc'

import type { AgentDevice } from './store'

const teamId = '65f000000000000000000001'
const running = {
  deviceId: 'd1',
  box: { provider: 'instabox', teamId, sandboxId: 'm_1', createdBy: 'u1' },
} as unknown as AgentDevice

const installStore = useAgentDeviceStore({ getAgentDevice: () => Promise.resolve(running) })

useBoxInstaboxLimit({
  startWithinLimit: (_team: string, _starting: unknown, start: () => Promise<unknown>) => start(),
})

const saved = config.box.instabox

beforeEach(() => {
  config.box.instabox = { apiKey: 'workspace-key' }
})
afterEach(() => {
  config.box.instabox = saved
})

test('opening a Box desktop with a workspace key starts the desktop and asks for no link', async () => {
  const calls: string[] = []
  // As instabox answers a workspace key: desktop links are only the machine creator's.
  const refused = new InstaboxAuthError(
    "desktop links are the sandbox creator's: a workspace API key cannot make or revoke them",
    { status: 403, code: 'permission_denied' },
  )
  const connect = spyOn(Sandbox, 'connect').mockResolvedValue({
    desktop: {
      start: () => {
        calls.push('start')

        return Promise.resolve()
      },
      streamUrl: () => {
        calls.push('streamUrl')

        return Promise.reject(refused)
      },
    },
  } as unknown as Sandbox)

  try {
    await startBoxDesktop('u1', 'd1')
    expect(calls).toEqual(['start'])
  } finally {
    connect.mockRestore()
  }
})

test("the Box's VNC is instabox's WebSocket, admitted by the account's key", async () => {
  expect(await boxVncUpstream('u1', 'd1')).toEqual({
    url: 'wss://api.instabox.sh/v1/machines/m_1/vnc',
    headers: { 'X-API-Key': 'workspace-key' },
  })
})

test('the relay carries RFB bytes as base64 both ways and drops control frames', () => {
  const remote = new EventTarget() as EventTarget & {
    binaryType: string
    readyState: number
    sent: unknown[]
    send: (data: unknown) => void
    close: () => void
  }

  remote.sent = []
  remote.readyState = WebSocket.OPEN
  remote.send = (data) => remote.sent.push(data)
  remote.close = () => remote.sent.push('closed')
  const toViewer: unknown[] = []
  const viewer = { send: (d: unknown) => toViewer.push(d), close: () => toViewer.push('closed') }
  const relay = boxVncRelay({ url: 'wss://x', headers: {} }, () => remote as unknown as WebSocket)

  relay.onOpen?.(new Event('open'), viewer as never)
  remote.dispatchEvent(
    Object.assign(new Event('message'), { data: new TextEncoder().encode('RFB 003.008\n').buffer }),
  )
  expect(toViewer).toEqual([Buffer.from('RFB 003.008\n').toString('base64')])

  relay.onMessage?.(
    new MessageEvent('message', { data: Buffer.from([1, 2, 3]).toString('base64') }),
    viewer as never,
  )
  relay.onMessage?.(
    new MessageEvent('message', { data: JSON.stringify({ t: 'control', owner: 'human' }) }),
    viewer as never,
  )
  expect(remote.sent).toEqual([Buffer.from([1, 2, 3])])

  remote.dispatchEvent(new Event('close'))
  expect(toViewer.at(-1)).toBe('closed')
})

test("a team's own key that instabox refuses says how to fix it", async () => {
  const own = { ...running, box: { ...running.box, accountId: '65f0000000000000000000aa' } }
  const connect = spyOn(Sandbox, 'connect').mockResolvedValue({
    desktop: {
      start: () =>
        Promise.reject(new InstaboxAuthError('missing scope', { status: 403, code: 'forbidden' })),
    },
  } as unknown as Sandbox)
  const account = spyOn(accountModule, 'boxConnection').mockResolvedValue({
    apiKey: 'team-key',
    requestTimeoutMs: 1,
    operationTimeoutMs: 1,
  })

  installStore({ getAgentDevice: () => Promise.resolve(own as AgentDevice) })
  try {
    await expect(startBoxDesktop('u1', 'd1')).rejects.toMatchObject({
      status: 409,
      code: 'instabox_key_rejected',
    })
  } finally {
    connect.mockRestore()
    account.mockRestore()
    installStore({ getAgentDevice: () => Promise.resolve(running) })
  }
})
