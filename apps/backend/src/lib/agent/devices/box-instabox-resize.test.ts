import { beforeEach, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { useAgentDeviceStore } from '@/lib/test/doubles/agent-devices-store'
import { useBoxInstabox } from '@/lib/test/doubles/box-instabox'
import { useBoxInstaboxAccount } from '@/lib/test/doubles/box-instabox-account'
import { useBoxInstaboxLimit } from '@/lib/test/doubles/box-instabox-limit'
import { useBoxUsageHistory } from '@/lib/test/doubles/box-usage-history'
import { useInstaboxMachines } from '@/lib/test/doubles/instabox-machines'

import { boxSizeView, resizeBox } from './box-instabox-resize'

import type { AgentDevice } from './store'

// A Box on the deployment's account, 2 vCPU with a 20 GB /data; its account offers 2, 4 and 8.
const teamId = '65f000000000000000000001'
const sizes = [
  { vcpus: 2, memMiB: 4096 },
  { vcpus: 4, memMiB: 8192 },
  { vcpus: 8, memMiB: 16384 },
]
let device: AgentDevice
let state: string
let usedVcpus: number
let limit: number | undefined
let resizeFails: boolean
let marked: boolean
const calls: unknown[][] = []

useAgentDeviceStore({
  getAgentDevice: () => Promise.resolve(device),
  agentDevices: () => ({
    updateOne: (_filter: unknown, update: Record<string, unknown>) => {
      calls.push(['write', update])

      return Promise.resolve({ matchedCount: marked ? 1 : 0 })
    },
  }),
})
useInstaboxMachines({
  machineSize: () => Promise.resolve({ state, vcpus: 2, memMiB: 4096, diskGiB: 20 }),
  stopMachine: (_conn: unknown, id: string) => {
    calls.push(['stop', id])

    return Promise.resolve()
  },
  resizeMachine: (_conn: unknown, id: string, change: unknown) => {
    calls.push(['resize', id, change])

    return resizeFails ? Promise.reject(new Error('no room on the host')) : Promise.resolve()
  },
})
useBoxInstaboxLimit({
  boxSizes: () => Promise.resolve(sizes),
  boxSize: (vcpus?: number) => {
    const size = sizes.find((s) => s.vcpus === vcpus)

    return size ? Promise.resolve(size) : Promise.reject(new AppError(400, 'box_size', 'no'))
  },
  teamVcpuLimit: () => Promise.resolve({ limit, own: true }),
  teamBoxUsage: () => Promise.resolve({ machines: [], usedVcpus }),
})
useBoxInstaboxAccount({ boxConnection: () => Promise.resolve({ apiKey: 'test' }) })
useBoxUsageHistory({ noteBoxUsage: () => {} })
useBoxInstabox({
  resumeBox: (_u: string, id: string) => {
    calls.push(['resume', id])

    return Promise.resolve(device)
  },
})

beforeEach(() => {
  calls.length = 0
  device = {
    userId: 'u1',
    deviceId: 'd1',
    box: { provider: 'instabox', teamId, sandboxId: 'm_1', createdBy: 'u1' },
  } as unknown as AgentDevice
  state = 'running'
  usedVcpus = 2
  limit = 8
  resizeFails = false
  marked = true
})

/** The resize runs in the background; it is done once nothing more happens. */
async function settled() {
  for (let seen = -1; seen !== calls.length;) {
    seen = calls.length
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('a running Box is stopped, resized and started again, and marked meanwhile', async () => {
  const resizing = await resizeBox('u1', 'd1', { vcpus: 8, diskGiB: 50 })

  expect(resizing.box?.resize?.startedAt).toBeInstanceOf(Date)
  await settled()
  expect(calls).toEqual([
    ['write', { $set: { 'box.resize': { startedAt: expect.any(Date) } } }],
    ['stop', 'm_1'],
    ['resize', 'm_1', { vcpus: 8, memMiB: 16384, diskGiB: 50 }],
    ['write', { $unset: { 'box.resize': '' } }],
    ['resume', 'd1'],
  ])
})

test('only what changes is sent, and a paused Box stays stopped until its next resume', async () => {
  state = 'suspended'
  await resizeBox('u1', 'd1', { vcpus: 2, diskGiB: 30 })
  await settled()
  expect(calls.filter(([what]) => what !== 'write')).toEqual([
    ['stop', 'm_1'],
    ['resize', 'm_1', { diskGiB: 30 }],
  ])
})

test('the disk never shrinks and an unchanged size is refused, before anything stops', async () => {
  await expect(resizeBox('u1', 'd1', { diskGiB: 10 })).rejects.toMatchObject({
    status: 400,
    code: 'box_disk_shrink',
  })
  await expect(resizeBox('u1', 'd1', { vcpus: 2, diskGiB: 20 })).rejects.toMatchObject({
    status: 400,
    code: 'box_resize_unchanged',
  })
  await expect(resizeBox('u1', 'd1', { vcpus: 3 })).rejects.toMatchObject({ code: 'box_size' })
  expect(calls).toEqual([])
})

test('a running Box grows only within the team’s vCPU limit, its own vCPUs counted once', async () => {
  usedVcpus = 6
  await expect(resizeBox('u1', 'd1', { vcpus: 8 })).rejects.toMatchObject({
    status: 402,
    code: 'box_vcpu_limit',
  })
  usedVcpus = 2
  await resizeBox('u1', 'd1', { vcpus: 8 })
  await settled()
  expect(calls).toContainEqual(['resume', 'd1'])
})

test('a team’s own account is not held to Nuphos’s limit', async () => {
  device = { ...device, box: { ...device.box!, accountId: 'acct' } }
  usedVcpus = 100
  await resizeBox('u1', 'd1', { vcpus: 8 })
  await settled()
  expect(calls).toContainEqual(['resume', 'd1'])
})

test('a failed resize is kept for the clients and the Box comes back at its old size', async () => {
  resizeFails = true
  await resizeBox('u1', 'd1', { diskGiB: 40 })
  await settled()
  expect(calls.slice(-2)).toEqual([
    [
      'write',
      { $set: { 'box.resize': { error: 'Could not resize the Box: no room on the host' } } },
    ],
    ['resume', 'd1'],
  ])
})

test('a second resize while one runs is refused', async () => {
  marked = false
  await expect(resizeBox('u1', 'd1', { diskGiB: 40 })).rejects.toMatchObject({
    status: 409,
    code: 'box_resizing',
  })
  expect(calls.filter(([what]) => what !== 'write')).toEqual([])
})

test('an updating Box is not resized', async () => {
  device = { ...device, box: { ...device.box!, updateStartedAt: new Date() } }
  await expect(resizeBox('u1', 'd1', { diskGiB: 40 })).rejects.toMatchObject({
    code: 'box_updating',
  })
})

test('the size view has the machine’s size and the sizes its account offers', async () => {
  expect(await boxSizeView('u1', 'd1')).toEqual({
    vcpus: 2,
    memMiB: 4096,
    diskGiB: 20,
    running: true,
    sizes,
    maxDiskGiB: 1024,
  })
})
