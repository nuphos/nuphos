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
  /** Its suspend is still uploading: instabox refuses every other operation on it. */
  pausing?: boolean
  metadata?: Record<string, string>
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
  metadata: machine.metadata ?? {},
  createdAt: '2026-11-17T00:00:00Z',
  updatedAt: '2026-11-17T00:00:00Z',
})

/** The machines this instabox knows, by id; a scenario adds and changes them. */
export const instaboxMachines = new Map<string, StubMachine>()
const machines = instaboxMachines

/** A scenario's part in each exec: it sees the command, and returns how long its answer is held. */
export const instaboxExec: { onRun?: (cmd: string, envs: Record<string, string>) => number } = {}

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
        const { name, metadata } = JSON.parse(Buffer.concat(chunks).toString()) as {
          name: string
          metadata?: Record<string, string>
        }

        machines.set(name, { id: name, state: 'running', operations: [], metadata })
        send(202, { id: `op_${name}`, type: 'create', state: 'succeeded', machineId: name })
      })

      return
    }
    if (request.method !== 'GET' && machine?.pausing)
      return send(409, {
        error: { code: 'operation_conflict', message: 'machine has an active suspend operation' },
      })
    if (request.method === 'POST' && machine && part === 'exec') {
      const chunks: Buffer[] = []

      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const { cmd, envs = {} } = JSON.parse(Buffer.concat(chunks).toString()) as {
          cmd: string
          envs?: Record<string, string>
        }

        machine.commands ??= []
        machine.commands.push(cmd)
        const holdMs = instaboxExec.onRun?.(cmd, envs) ?? 0

        setTimeout(() => send(200, { stdout: '12345\n', stderr: '', exitCode: 0 }), holdMs)
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
    if (path === '/v1/machines') {
      // Those with every `key:value` asked for, as instabox filters a team's machines; one a
      // scenario added without metadata is in every list.
      const wanted = new URL(request.url ?? '/', 'http://instabox').searchParams.getAll('metadata')
      const matching = [...machines.values()].filter(
        (m) =>
          !m.metadata ||
          wanted.every((pair) => {
            const [key, ...value] = pair.split(':')

            return m.metadata?.[key] === value.join(':')
          }),
      )

      return send(200, { machines: matching.map(machineView), nextCursor: null })
    }
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
