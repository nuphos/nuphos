// instabox as the backend sees it: only the machines a scenario adds, each with its
// operation log. Nothing here starts, pauses or resumes a machine. An order is accepted and
// its machine runs, but nothing on it ever answers, so a new Box stays starting.
import { createServer } from 'node:http'

export type StubOperation = { type: string; state: string; trigger?: string; createdAt: string }
export type StubMachine = {
  id: string
  state: string
  operations: StubOperation[]
  commands?: string[]
}

const machineView = (machine: StubMachine) => ({
  id: machine.id,
  name: machine.id,
  state: machine.state,
  desiredState: machine.state,
  revision: 1,
  operationId: null,
  template: { id: 'agent-browser', version: 'e2e', digest: 'sha256:e2e' },
  spec: { vcpus: 2, memMiB: 4096, persistentDiskGiB: 20 },
  storage: { sizeGiB: 20, mountPath: '/data', persistent: true, synced: true },
  runtime: { ready: machine.state === 'running' },
  metadata: {},
  createdAt: '2026-11-17T00:00:00Z',
  updatedAt: '2026-11-17T00:00:00Z',
})

/** The machines this instabox knows, by id; a scenario adds and changes them. */
export const instaboxMachines = new Map<string, StubMachine>()
const machines = instaboxMachines

/** Starts it on a free port; the backend's environment to reach it. */
export async function startInstaboxStub(): Promise<Record<string, string>> {
  const server = createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    const path = new URL(request.url ?? '/', 'http://instabox').pathname
    const [, , kind, id, part] = path.split('/')
    const machine = kind === 'machines' && id ? machines.get(decodeURIComponent(id)) : undefined

    if (request.method === 'POST' && path === '/v1/machines') {
      const chunks: Buffer[] = []

      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const { name } = JSON.parse(Buffer.concat(chunks).toString()) as { name: string }

        machines.set(name, { id: name, state: 'running', operations: [] })
        send(202, { id: `op_${name}`, type: 'create', state: 'succeeded', machineId: name })
      })

      return
    }
    if (request.method === 'POST' && machine && part === 'exec') {
      const chunks: Buffer[] = []

      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const { cmd } = JSON.parse(Buffer.concat(chunks).toString()) as { cmd: string }

        machine.commands ??= []
        machine.commands.push(cmd)
        send(200, { stdout: '12345\n', stderr: '', exitCode: 0 })
      })

      return
    }
    // A team key that has expired: instabox refuses to kill the machine (#3733).
    if (request.method === 'DELETE' && machine)
      return send(401, { error: { code: 'expired_key', message: 'API key expired' } })
    // The machine's own work (its idle pause, its install) never finishes.
    if (request.method !== 'GET') return
    if (path === '/v1/templates') return send(200, { templates: [{ id: 'agent-browser' }] })
    if (path === '/v1/me')
      return send(200, { allowedSpecs: [{ vcpus: 2, memMiB: 4096, persistentDiskGiB: 20 }] })
    if (path === '/v1/machines')
      return send(200, { machines: [...machines.values()].map(machineView), nextCursor: null })
    if (machine && !part) return send(200, machineView(machine))
    if (machine && part === 'logs')
      return send(200, {
        machineId: machine.id,
        state: machine.state,
        console: '',
        operations: machine.operations,
      })
    send(404, { error: { code: 'not_found', message: 'No such machine in the e2e instabox' } })
  })

  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening))
  server.unref()
  const { port } = server.address() as { port: number }

  return {
    INSTABOX_API_KEY: 'e2e-instabox-key-not-a-production-credential',
    INSTABOX_API_URL: `http://127.0.0.1:${String(port)}`,
  }
}
