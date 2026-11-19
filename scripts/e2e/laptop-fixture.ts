import { createHash, randomUUID } from 'node:crypto'

import { boxRow, me } from './box-scenarios.ts'
import { instaboxMachines } from './instabox-stub.ts'

import type { Stack } from './stack.ts'

export const LAPTOP = 'E2E laptop'

const GIB = 1024 ** 3

/** A signed-in computer, online until the returned cleanup function is called. */
export async function laptopOnline(
  stack: Stack,
  {
    diskPercent,
    client,
    app,
    box,
    owner = { token: stack.token, deviceId: 'e2e-laptop', label: LAPTOP },
  }: {
    diskPercent?: number
    client?: string
    app?: { version: string; update: { version: string; ready: boolean } }
    box?: string
    owner?: { token: string; deviceId: string; label: string }
  } = {},
): Promise<() => void> {
  const { deviceId, authorization, remove } = box
    ? await boxRegistered(stack, box)
    : await laptopRegistered(stack, owner)
  const tunnel = new WebSocket(
    `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${deviceId}/runtime-tunnel`,
    {
      headers: { authorization, ...(client ? { 'x-atlas-client': client } : {}) },
    } as unknown as string[],
  )

  tunnel.addEventListener('message', () => tunnel.send(JSON.stringify({ t: 'pong' })))
  await new Promise((opened, failed) => {
    tunnel.addEventListener('open', opened)
    tunnel.addEventListener('error', failed)
  })
  tunnel.send(
    JSON.stringify({
      t: 'status',
      status: {
        localMetrics: diskPercent !== undefined,
        app,
        agents: { 'claude-code': { cli: { installed: true, loggedIn: true } } },
      },
    }),
  )
  if (diskPercent === undefined)
    return () => {
      tunnel.close()
      remove?.()
    }
  const report = () =>
    tunnel.send(
      JSON.stringify({
        t: 'metrics',
        metrics: {
          sampledAt: new Date().toISOString(),
          cpuPercent: 12,
          memory: { used: 6 * GIB, total: 16 * GIB },
          disk: { used: diskPercent * GIB, total: 100 * GIB },
        },
      }),
    )
  // A reading counts as live for 12 seconds.
  const reporting = setInterval(report, 4_000)

  report()

  return () => {
    clearInterval(reporting)
    tunnel.close()
    remove?.()
  }
}

async function laptopRegistered(
  stack: Stack,
  owner: { token: string; deviceId: string; label: string },
) {
  const authorization = `Bearer ${owner.token}`
  const registered = await fetch(`${stack.apiUrl}/agent/devices`, {
    method: 'PUT',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId: owner.deviceId,
      label: owner.label,
      platform: 'darwin',
      allowLocalExec: true,
    }),
  })

  if (!registered.ok) throw new Error(`Registering the laptop answered ${registered.status}`)

  return { deviceId: owner.deviceId, authorization, remove: undefined }
}

/** A running Box of this person's, as box-scenarios makes one; `remove` takes it away again. */
async function boxRegistered(stack: Stack, label: string) {
  const deviceId = randomUUID()
  const sandboxId = `m_e2e_${deviceId.slice(0, 8)}`
  const credential = `nbx_e2e_${randomUUID()}`
  const userId = await me(stack)

  instaboxMachines.set(sandboxId, { id: sandboxId, state: 'running', operations: [] })
  boxRow(stack.mongoUri, {
    userId,
    deviceId,
    label,
    platform: 'linux',
    allowLocalExec: true,
    credentialHash: createHash('sha256').update(credential).digest('base64url'),
    box: { provider: 'instabox', sandboxId, teamId: stack.teamId, createdBy: userId },
    access: [{ teamId: stack.teamId, everyone: false, userIds: [], managerIds: [] }],
  })

  return {
    deviceId,
    authorization: `Bearer ${credential}`,
    remove: () => {
      boxRow(stack.mongoUri, { remove: deviceId })
      instaboxMachines.delete(sandboxId)
    },
  }
}
