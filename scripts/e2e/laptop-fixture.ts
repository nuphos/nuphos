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
    restoreFails,
    owner = { token: stack.token, deviceId: 'e2e-laptop', label: LAPTOP },
  }: {
    diskPercent?: number
    client?: string
    app?: { version: string; update: { version: string; ready: boolean } }
    /** Answer every ACP request after `initialize` as a runtime that cannot restore (#3371). */
    restoreFails?: boolean
    owner?: { token: string; deviceId: string; label: string }
  } = {},
): Promise<() => void> {
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
  const tunnel = new WebSocket(
    `${stack.apiUrl.replace(/^http/, 'ws')}/agent/devices/${owner.deviceId}/runtime-tunnel`,
    {
      headers: { authorization, ...(client ? { 'x-atlas-client': client } : {}) },
    } as unknown as string[],
  )

  tunnel.addEventListener('message', (event: MessageEvent) => {
    tunnel.send(JSON.stringify({ t: 'pong' }))
    if (restoreFails) answerAsOldRuntime(tunnel, String(event.data))
  })
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
  if (diskPercent === undefined) return () => tunnel.close()
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
  }
}

export const RESTORE_FAILED = 'Could not restore the saved session; it is kept for the next attempt'

// How a runtime without #3373 answered once it could not restore the saved session (#3371).
function answerAsOldRuntime(tunnel: WebSocket, raw: string) {
  const frame = JSON.parse(raw) as { t: string; s?: string; d?: string }
  const reply = (d: unknown) =>
    tunnel.send(JSON.stringify({ t: 'data', s: frame.s, d: JSON.stringify(d) }))

  if (frame.t === 'open') tunnel.send(JSON.stringify({ t: 'opened', s: frame.s }))
  if (frame.t !== 'data' || !frame.d) return
  const request = JSON.parse(frame.d) as { id?: number; method?: string }

  if (request.id === undefined || !request.method) return
  if (request.method === 'initialize')
    reply({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          _meta: { 'dev.openab/permissionRelay': true, 'dev.openab/sessionAuthority': 2 },
        },
        authMethods: [],
      },
    })
  else reply({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: RESTORE_FAILED } })
}
