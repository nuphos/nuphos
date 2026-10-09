import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDeviceAudit } from '@/lib/test/doubles/agent-devices-audit'
import { useAgentDeviceDispatch } from '@/lib/test/doubles/agent-devices-dispatch'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'

import type { DeviceExecAuditInput } from '@/lib/agent/devices/audit'
import type { LocalExecDispatchOutcome } from '@/lib/agent/devices/dispatch'
import type { z } from 'zod'

let dispatchCalls: { userId: string; deviceId: string; command: string }[]
let dispatchOutcome: LocalExecDispatchOutcome | Error
let audits: DeviceExecAuditInput[]
let teams: Set<string>

useAgentDeviceStore({
  isActiveTeamMember: async (userId, teamId) => teams.has(`${userId}:${teamId}`),
})

useAgentDeviceDispatch({
  dispatchLocalExec: async (userId, deviceId, command) => {
    dispatchCalls.push({ userId, deviceId, command })
    if (dispatchOutcome instanceof Error) throw dispatchOutcome

    return dispatchOutcome
  },
})

useAgentDeviceAudit({
  recordDeviceExecAudit: async (input) => {
    audits.push(input)
  },
})

const { createLocalExecTool } = await import('./local-tools')
const { createLocalTerminalTool } = await import('./local-terminal')

const turn = {
  userId: 'u1',
  conversationOwnerUserId: 'u1',
  teamId: 't1',
  sessionId: 's1',
  origin: 'user' as const,
}

type ExecTool = {
  inputSchema: z.ZodObject<{ device: z.ZodTypeAny }>
  execute: (input: unknown, options: unknown) => Promise<unknown>
}

beforeEach(() => {
  dispatchCalls = []
  audits = []
  teams = new Set(['u1:t1'])
  dispatchOutcome = { status: 'ok', result: { stdout: 'ok', stderr: '', exitCode: 0 } }
})

const twoDevices = [
  { deviceId: 'd1', label: 'MacBook' },
  { deviceId: 'd2', label: 'Linux box' },
]

describe('createLocalExecTool schema', () => {
  test('the schema never bakes in a device list that could go stale', () => {
    for (const devices of [[], [{ deviceId: 'd1', label: 'MacBook' }], twoDevices]) {
      const field = (createLocalExecTool(devices, turn) as ExecTool).inputSchema.shape.device

      expect(field.isOptional()).toBe(true)
      expect(field.description).not.toContain('d1')
    }
  })
})

describe('createLocalExecTool execute', () => {
  test('defaults to the sole device when device is omitted', async () => {
    const tool = createLocalExecTool([{ deviceId: 'd1', label: 'MacBook' }], turn) as ExecTool
    const result = await tool.execute({ label: 'run', command: 'echo hi' }, {})

    expect(result).toEqual({ stdout: 'ok', stderr: '', exitCode: 0 })
    expect(dispatchCalls).toEqual([{ userId: 'u1', deviceId: 'd1', command: 'echo hi' }])
  })

  test('returns a clear error when the device is ambiguous', async () => {
    const tool = createLocalExecTool(twoDevices, turn) as ExecTool
    const result = await tool.execute({ label: 'run', command: 'echo hi' }, {})

    expect(result).toEqual({
      error:
        'Multiple devices are available; pass device=<deviceId>, one of: d1 (MacBook), d2 (Linux box).',
    })
    expect(dispatchCalls).toEqual([])
  })

  test('runs an unknown device id on the sole available device and says so', async () => {
    const tool = createLocalExecTool([{ deviceId: 'd1', label: 'MacBook' }], turn) as ExecTool
    const result = await tool.execute({ label: 'run', command: 'echo hi', device: 'default' }, {})

    expect(result).toEqual({ stdout: 'ok', stderr: '', exitCode: 0, ranOn: 'd1 (MacBook)' })
    expect(dispatchCalls).toEqual([{ userId: 'u1', deviceId: 'd1', command: 'echo hi' }])
  })

  test('rejects an unknown device id among several and lists the current ones', async () => {
    const tool = createLocalExecTool(twoDevices, turn) as ExecTool
    const result = await tool.execute({ label: 'run', command: 'echo hi', device: 'd9' }, {})

    expect(result).toEqual({
      error:
        'Device d9 is not available; pass device=<deviceId>, one of: d1 (MacBook), d2 (Linux box).',
    })
    expect(dispatchCalls).toEqual([])
  })

  test('surfaces a clean error when no devices are available', async () => {
    const tool = createLocalExecTool([], turn) as ExecTool
    const result = await tool.execute({ label: 'run', command: 'echo hi' }, {})

    expect(result).toEqual({
      error:
        "No local devices are available for this conversation. Ask the user to select their device in this conversation's credential selector (the shield button in the composer); they must have Nuphos Desktop open and signed in on that device.",
    })
    expect(dispatchCalls).toEqual([])
  })

  test('maps a mid-flight disconnect to a clear error', async () => {
    dispatchOutcome = { status: 'device_disconnected' }
    const tool = createLocalExecTool([{ deviceId: 'd1', label: 'MacBook' }], turn) as ExecTool
    const result = await tool.execute({ label: 'run', command: 'echo hi' }, {})

    expect(result).toEqual({ error: 'Device disconnected while the command was running.' })
  })

  test('maps a timeout to a clear error', async () => {
    dispatchOutcome = { status: 'timeout' }
    const tool = createLocalExecTool([{ deviceId: 'd1', label: 'MacBook' }], turn) as ExecTool
    const result = await tool.execute({ label: 'run', command: 'echo hi' }, {})

    expect(result).toEqual({ error: 'Timed out waiting for the device to run the command.' })
  })
})

describe('createLocalExecTool membership', () => {
  test('denies and audits a run once the owner has left the session team', async () => {
    teams = new Set()
    const tool = createLocalExecTool([{ deviceId: 'd1', label: 'MacBook' }], turn) as ExecTool
    const result = await tool.execute({ label: 'run', command: 'echo hi' }, {})

    expect(result).toEqual({ error: 'You are no longer a member of this team.' })
    expect(dispatchCalls).toEqual([])
    expect(audits[0]).toMatchObject({
      teamId: 't1',
      deviceId: 'd1',
      outcome: 'rejected',
      reason: 'not_team_member',
    })
  })

  test('refuses and audits a run in a conversation someone else owns', async () => {
    const tool = createLocalExecTool([{ deviceId: 'd1', label: 'MacBook' }], {
      ...turn,
      conversationOwnerUserId: 'owner-1',
    }) as ExecTool
    const result = await tool.execute({ label: 'run', command: 'echo hi' }, {})

    expect(result).toEqual({ error: 'Local exec only runs in your own conversations.' })
    expect(dispatchCalls).toEqual([])
    expect(audits[0]).toMatchObject({
      deviceId: 'd1',
      actorUserId: 'u1',
      conversationOwnerUserId: 'owner-1',
      outcome: 'rejected',
      reason: 'not_own_conversation',
    })
  })
})

describe('createLocalExecTool audit', () => {
  test('records a successful run with the turn identity and exit code, never the output', async () => {
    dispatchOutcome = { status: 'ok', result: { stdout: 'secret output', stderr: '', exitCode: 3 } }
    const tool = createLocalExecTool([{ deviceId: 'd1', label: 'MacBook' }], turn) as ExecTool

    await tool.execute({ label: 'run', command: 'false' }, {})

    expect(audits).toHaveLength(1)
    const [entry] = audits

    expect(entry).toMatchObject({
      ownerUserId: 'u1',
      actorUserId: 'u1',
      conversationOwnerUserId: 'u1',
      origin: 'user',
      teamId: 't1',
      sessionId: 's1',
      deviceId: 'd1',
      command: 'false',
      outcome: 'ok',
      exitCode: 3,
    })
    expect(entry?.dispatchedAt).toBeInstanceOf(Date)
    expect(entry?.finishedAt.getTime()).toBeGreaterThanOrEqual(entry?.requestedAt.getTime() ?? 0)
    expect(JSON.stringify(entry)).not.toContain('secret output')
  })

  test('records a device that went offline mid-flight', async () => {
    dispatchOutcome = { status: 'device_disconnected' }
    const tool = createLocalExecTool([{ deviceId: 'd1', label: 'MacBook' }], turn) as ExecTool

    await tool.execute({ label: 'run', command: 'sleep 5' }, {})

    expect(audits.map((a) => a.outcome)).toEqual(['device_offline'])
  })

  test('records a timeout', async () => {
    dispatchOutcome = { status: 'timeout' }
    const tool = createLocalExecTool([{ deviceId: 'd1', label: 'MacBook' }], turn) as ExecTool

    await tool.execute({ label: 'run', command: 'sleep 99' }, {})

    expect(audits.map((a) => a.outcome)).toEqual(['timeout'])
  })

  test('records a rejected dispatch to an unavailable device without dispatching', async () => {
    const tool = createLocalExecTool(twoDevices, turn) as ExecTool

    await tool.execute({ label: 'run', command: 'ls', device: 'd9' }, {})

    expect(dispatchCalls).toEqual([])
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({
      deviceId: 'd9',
      outcome: 'rejected',
      reason: 'device_unavailable',
    })
    expect(audits[0]?.dispatchedAt).toBeUndefined()
  })

  test('records a dispatch failure and rethrows', async () => {
    dispatchOutcome = new Error('redis down')
    const tool = createLocalExecTool([{ deviceId: 'd1', label: 'MacBook' }], turn) as ExecTool

    let thrown: unknown

    try {
      await tool.execute({ label: 'run', command: 'ls' }, {})
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(audits.map((a) => [a.outcome, a.reason])).toEqual([['error', 'dispatch_failed']])
  })
})

describe('shared dock terminal authorization', () => {
  test('binds requests to the server conversation and records an audit', async () => {
    dispatchOutcome = {
      status: 'ok',
      result: { stdout: '{"terminalId":"tab-1"}', stderr: '', exitCode: 0 },
    }
    const tool = createLocalTerminalTool(twoDevices, turn) as ExecTool
    const result = await tool.execute(
      { label: 'open', action: 'open', device: 'd1', sessionId: 'forged' },
      {},
    )

    expect(result).toEqual({ terminalId: 'tab-1' })
    expect(JSON.parse(dispatchCalls[0]!.command)).toMatchObject({
      sessionId: 's1',
      teamId: 't1',
      action: 'open',
    })
    expect(audits[0]).toMatchObject({ deviceId: 'd1', sessionId: 's1', outcome: 'ok' })
  })

  test('rejects another participant and an unavailable device without dispatch', async () => {
    const other = createLocalTerminalTool(twoDevices, {
      ...turn,
      conversationOwnerUserId: 'u2',
    }) as ExecTool

    expect(await other.execute({ label: 'open', action: 'open', device: 'd1' }, {})).toHaveProperty(
      'error',
    )
    const single = createLocalTerminalTool([twoDevices[0]!], turn) as ExecTool

    expect(
      await single.execute({ label: 'open', action: 'open', device: 'missing' }, {}),
    ).toHaveProperty('error')
    expect(dispatchCalls).toEqual([])
  })
})
