// Scenarios about a member's streams on the team's Box, which only rules for a team's Boxes reach.
import { createHash, randomUUID } from 'node:crypto'

import { client, joinAsAdmin, must } from './binding-access-scenarios.ts'
import { boxRow, me } from './box-scenarios.ts'
import { instaboxMachines } from './instabox-stub.ts'
import { until } from './processes.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'

type Frame = { t: string; s?: string; purpose?: string }

function opened(socket: WebSocket) {
  return new Promise((done, failed) => {
    socket.addEventListener('open', done)
    socket.addEventListener('error', failed)
  })
}

// A member who manages the team's Box watches its desktop. A new role leaves that stream open;
// leaving the team closes it, which shows the stream is one revocation reaches.
export async function teamBoxStreamFlow(stack: Stack) {
  const owner = client(stack.apiUrl, stack.token)
  const { memberId, token } = await joinAsAdmin(stack, owner)
  const ownerId = await me(stack)
  const deviceId = randomUUID()
  const sandboxId = `m_e2e_${deviceId.slice(0, 8)}`
  const credential = `nbx_e2e_${randomUUID()}`
  const runtimeId = `local_${ownerId}_${deviceId}`
  const ws = stack.apiUrl.replace(/^http/, 'ws')

  instaboxMachines.set(sandboxId, { id: sandboxId, state: 'running', operations: [] })
  boxRow(stack.mongoUri, {
    userId: ownerId,
    deviceId,
    label: 'E2E team Box',
    platform: 'linux',
    allowLocalExec: true,
    credentialHash: createHash('sha256').update(credential).digest('base64url'),
    box: { provider: 'instabox', sandboxId, teamId: stack.teamId, createdBy: ownerId },
    access: [
      { teamId: stack.teamId, everyone: false, userIds: [memberId], managerIds: [memberId] },
    ],
  })
  // The Box's host, signed in with its device credential as a real one is.
  const host = new WebSocket(`${ws}/agent/devices/${deviceId}/runtime-tunnel`, {
    headers: { authorization: `Bearer ${credential}` },
  } as unknown as string[])
  const frames: Frame[] = []

  host.addEventListener('message', (event: MessageEvent) => {
    const frame = JSON.parse(String(event.data)) as Frame

    frames.push(frame)
    host.send(JSON.stringify({ t: 'pong' }))
    if (frame.t === 'open') host.send(JSON.stringify({ t: 'opened', s: frame.s }))
  })
  try {
    await opened(host)
    host.send(
      JSON.stringify({
        t: 'status',
        status: { agents: {}, desktops: [{ display: 0, sessionId: `runtime:${runtimeId}` }] },
      }),
    )
    // The Box is listed once its status is recorded, so the member retries until it is.
    let viewer: WebSocket | undefined

    await until('the member to open the Box’s desktop', async () => {
      const socket = new WebSocket(
        `${ws}/teams/${stack.teamId}/runtime-desktop/runtime/${runtimeId}/0`,
        { headers: { authorization: `Bearer ${token}` } } as unknown as string[],
      )

      const open = await opened(socket).then(
        () => true,
        () => false,
      )

      if (open) viewer = socket

      return open
    })
    await until('the member’s stream to reach the Box', async () =>
      frames.some((frame) => frame.t === 'open' && frame.purpose === 'vnc'),
    )
    const stream = frames.find((frame) => frame.t === 'open')?.s
    const closed = () => frames.some((frame) => frame.t === 'close' && frame.s === stream)
    const role = await owner('PATCH', `/teams/${stack.teamId}/members/${memberId}`, {
      role: 'EDITOR',
    })

    must(role.status === 200, `the member's role to change, got ${String(role.status)}`)
    await new Promise((done) => setTimeout(done, 3_000))
    must(!closed() && viewer?.readyState === WebSocket.OPEN, 'a new role to leave the stream open')
    const removed = await owner('DELETE', `/teams/${stack.teamId}/members/${memberId}`)

    must(removed.status === 204, `the member to be removed, got ${String(removed.status)}`)
    await until('the removed member’s stream to close on the Box', async () => closed(), 10_000)
    await until(
      'the removed member’s viewer to close',
      async () => viewer?.readyState === WebSocket.CLOSED,
      10_000,
    )
  } finally {
    host.close()
    boxRow(stack.mongoUri, { remove: deviceId })
    instaboxMachines.delete(sandboxId)
  }
}

export const teamBoxAccessScenarios: Scenario[] = [
  {
    name: "a member's stream on the team's Box outlives a role change and closes when they leave",
    run: async (_page, stack) => teamBoxStreamFlow(stack),
  },
]
