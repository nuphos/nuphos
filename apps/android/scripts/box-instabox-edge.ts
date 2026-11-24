// Local HTTP edge double. Never forwards to instabox or executes shell commands.
import { createServer } from 'node:http'
export const machines = new Map<string, any>()
export let stubUrl = ''
let ready = false
const view = (m: any) => ({
  id: m.id,
  name: m.id,
  state: m.state,
  desiredState: m.state,
  revision: 1,
  operationId: null,
  template: { id: 'agent-browser', version: 'e2e', digest: 'sha256:e2e' },
  spec: { vcpus: 2, memMiB: 4096, persistentDiskGiB: 20 },
  storage: { sizeGiB: 20, mountPath: '/data', persistent: true, synced: true },
  runtime: { ready: true },
  metadata: m.metadata,
  createdAt: '2026-11-19T00:00:00Z',
  updatedAt: '2026-11-19T00:00:00Z',
})
async function host(m: any) {
  if (!ready || !m.join || m.ws?.readyState === 1) return
  if (new URL(m.api).hostname !== '127.0.0.1') throw Error('Only a loopback backend is permitted')
  if (!m.credential) {
    const r = await fetch(m.api + '/auth/devices/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: m.join, label: 'Android test computer', platform: 'linux' }),
    })
    if (!r.ok) throw Error('join failed ' + r.status)
    const data: any = await r.json()
    m.credential = data.credential
    m.deviceId = data.deviceId
    console.log('BOX_EDGE_JOIN', r.status)
  }
  const ws = new WebSocket(
    m.api.replace(/^http/, 'ws') + '/agent/devices/' + m.deviceId + '/runtime-tunnel',
    { headers: { authorization: 'Bearer ' + m.credential } } as any,
  )
  m.ws = ws
  ws.addEventListener('open', () => {
    const status = {
      agentInstances: true,
      agents: { codex: { cli: { installed: true, loggedIn: false } } },
    }
    ws.send(JSON.stringify({ t: 'status', status }))
    m.heartbeat = setInterval(() => {
      if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'status', status }))
    }, 5000)
    console.log('BOX_EDGE_HOST_CONNECTED')
  })
  ws.addEventListener('close', () => clearInterval(m.heartbeat))
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(String(e.data))
    if (msg.t === 'ping') ws.send(JSON.stringify({ t: 'pong' }))
  })
}
export async function startInstaboxStub(): Promise<Record<string, string>> {
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const path = new URL(req.url ?? '/', 'http://local').pathname
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString()
    const body = raw ? JSON.parse(raw) : {}
    const id = decodeURIComponent(path.split('/')[3] ?? '')
    const part = path.split('/')[4]
    const m = machines.get(id)
    try {
      if (path === '/test/ready') {
        ready = true
        for (const row of machines.values()) await host(row)
        return send(200, { ok: true })
      }
      if (path === '/test/pause') {
        for (const row of machines.values()) {
          row.state = 'suspended'
          row.ws?.close()
        }
        console.log('BOX_EDGE_PAUSED')
        return send(200, { ok: true })
      }
      if (path.startsWith('/test/')) return send(404, {})
      console.log('BOX_EDGE_HTTP', req.method, path)
      if (req.method === 'GET' && path === '/v1/templates')
        return send(200, { templates: [{ id: 'agent-browser' }] })
      if (req.method === 'GET' && path === '/v1/me')
        return send(200, { allowedSpecs: [{ vcpus: 2, memMiB: 4096, persistentDiskGiB: 20 }] })
      if (path === '/v1/machines' && req.method === 'GET')
        return send(200, { machines: [...machines.values()].map(view), nextCursor: null })
      if (path === '/v1/machines' && req.method === 'POST') {
        const row = { id: body.name, state: 'running', metadata: body.metadata }
        machines.set(row.id, row)
        return send(202, {
          id: 'op_' + row.id,
          type: 'create',
          state: 'succeeded',
          machineId: row.id,
        })
      }
      if (m && !part && (req.method === 'GET' || req.method === 'PATCH')) return send(200, view(m))
      if (m && part === 'logs')
        return send(200, { machineId: id, state: m.state, console: '', operations: [] })
      if (m && part === 'suspend' && req.method === 'POST') {
        m.state = 'suspended'
        m.ws?.close()
        return send(202, { id: 'op_pause', type: 'suspend', state: 'succeeded', machineId: id })
      }
      if (m && part === 'resume' && req.method === 'POST') {
        m.state = 'running'
        await host(m)
        return send(202, { id: 'op_resume', type: 'resume', state: 'succeeded', machineId: id })
      }
      if (m && part === 'exec' && req.method === 'POST') {
        if (body.envs?.NUPHOS_JOIN_TOKEN) {
          m.join = body.envs.NUPHOS_JOIN_TOKEN
          m.api = body.envs.NUPHOS_API_URL
          await host(m)
        } else if (body.envs?.NUPHOS_API_URL && m.join) await host(m)
        return send(200, {
          stdout: body.cmd.includes('setsid') ? '1234\n' : '',
          stderr: '',
          exitCode: 0,
          timedOut: false,
          truncated: false,
        })
      }
      if (m && req.method === 'DELETE') {
        m.ws?.close()
        machines.delete(id)
        return send(202, { id: 'op_delete', type: 'delete', state: 'succeeded', machineId: id })
      }
      send(404, { error: { code: 'not_found', message: 'Only local fixture machines exist' } })
    } catch (e) {
      console.error('BOX_EDGE_FAILURE', e instanceof Error ? e.message : 'failed')
      send(500, { error: { code: 'fixture_failure', message: 'Fixture failed' } })
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as any).port
  stubUrl = 'http://127.0.0.1:' + port
  return {
    INSTABOX_API_KEY: 'local-test-key-not-a-production-credential',
    INSTABOX_API_URL: 'http://127.0.0.1:' + port,
  }
}

if (import.meta.main) {
  await startInstaboxStub()
  console.log('Local instabox HTTP edge: ' + stubUrl)
}
