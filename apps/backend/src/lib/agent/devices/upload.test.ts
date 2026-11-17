import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import { createLocalTunnelBus } from './local-runtime/bus'
import { attachRuntimeTunnel } from './local-runtime/holder'
import { createMemoryPresenceStore } from './local-runtime/presence'
import { dispatchLocalUpload } from './upload'

import type { DeviceAccessDeps } from './box-access'
import type { RuntimeTunnel } from './local-runtime/holder'
import type { AgentDevice } from './store'
import type { TransferScope } from '@/lib/file-transfer/service'

// Import dynamically so backend type-checking does not pull in Electron's
// separate application/tsconfig. This stream uses only Node's built-ins.
type UploadStream = {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void
  send(data: string): void
  close(): void
}
const { LocalUploadStream } = (await import(
  resolve('../desktop/electron/main/local-runtime/upload-stream.ts')
)) as { LocalUploadStream: new () => UploadStream }

const teamId = new ObjectId()
const scope: TransferScope = { teamId, userId: 'conversation-owner', sessionId: 'conversation-a' }
const target: AgentDevice = {
  userId: 'computer-owner',
  deviceId: 'd1',
  label: 'Computer',
  platform: 'linux',
  allowLocalExec: true,
  box: { provider: 'instabox', teamId: teamId.toHexString() },
  access: [
    {
      teamId: teamId.toHexString(),
      everyone: false,
      userIds: ['conversation-owner', 'user'],
      // Reading a file off the computer is for those who manage it.
      managerIds: ['conversation-owner'],
    },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
}
const access: DeviceAccessDeps = {
  getDevice: () => Promise.resolve(target),
  listDevices: () => Promise.resolve([target]),
  listBoxes: () => Promise.resolve([target]),
  listGranted: () => Promise.resolve([]),
  findGranted: () => Promise.resolve([]),
  role: () => Promise.resolve('EDITOR'),
}
const tunnels: RuntimeTunnel[] = []

afterEach(() => {
  for (const tunnel of tunnels.splice(0)) tunnel.closed()
})

async function setup(
  options: {
    capability?: boolean
    member?: boolean
    onData?: (data: string, reply: (value: unknown) => void) => void
  } = {},
) {
  const bus = createLocalTunnelBus()
  const presence = createMemoryPresenceStore()
  let stream: UploadStream | undefined
  let requests = 0
  const tunnel = await attachRuntimeTunnel(
    'computer-owner',
    'd1',
    {
      send: (frame) => {
        if (frame.t === 'open') {
          expect(frame.purpose).toBe('upload')
          stream = new LocalUploadStream()
          stream.addEventListener('open', () =>
            tunnel.receive(JSON.stringify({ t: 'opened', s: frame.s })),
          )
          stream.addEventListener('message', (event) =>
            tunnel.receive(JSON.stringify({ t: 'data', s: frame.s, d: event.data })),
          )
          stream.addEventListener('close', () =>
            tunnel.receive(JSON.stringify({ t: 'close', s: frame.s })),
          )
        }
        if (frame.t === 'data') {
          requests++
          if (options.onData)
            options.onData(frame.d, (value) =>
              tunnel.receive(JSON.stringify({ t: 'data', s: frame.s, d: JSON.stringify(value) })),
            )
          else stream?.send(frame.d)
        }
        if (frame.t === 'close') stream?.close()
      },
      close: () => {},
    },
    { bus, presence, isMember: async () => options.member !== false, heartbeatMs: 60_000 },
  )

  tunnels.push(tunnel)
  tunnel.receive(
    JSON.stringify({
      t: 'status',
      status: { agents: {}, localExec: true, localUpload: options.capability !== false },
    }),
  )
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await Promise.resolve()

  return { bus, presence, requests: () => requests, tunnel }
}
const ready = (groupId: string, size: number) => ({
  groupId,
  direction: 'upload' as const,
  status: 'ready' as const,
  label: null,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  files: [
    {
      id: 'file',
      fileName: 'fixture.bin',
      relPath: 'fixture.bin',
      size,
      contentType: null,
      status: 'ready' as const,
    },
  ],
})

const created = (groupId: string, uploadUrl: string) => ({
  groupId,
  direction: 'upload' as const,
  status: 'pending' as const,
  expiresAt: new Date().toISOString(),
  files: [
    {
      id: 'file',
      fileName: 'fixture.bin',
      relPath: 'fixture.bin',
      uploadUrl,
      expiresAt: new Date().toISOString(),
    },
  ],
})
const pull = (groupId: string, dest: string, backendUrl: string) =>
  Bun.spawn(
    [
      'bash',
      resolve('src/lib/agent/builtin-skills/skills/file-transfer/scripts/transfer-pull.sh'),
      teamId.toHexString(),
      groupId,
      dest,
    ],
    {
      env: {
        ...process.env,
        OPENAB_CREDENTIALS_DIR: '',
        NUPHOS_BACKEND_URL: backendUrl,
        NUPHOS_TOKEN: 'non-secret-fixture',
        NUPHOS_SESSION_ID: scope.sessionId,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )

test('6 MiB shared-computer upload and pull preserve SHA-256 without exposing capabilities', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'device-upload-'))
  const fixture = Buffer.alloc(6 * 1024 * 1024, 42)
  const path = join(dir, 'fixture.bin')
  let uploaded: Uint8Array | undefined
  const groupId = new ObjectId().toHexString()
  const finalized = Promise.withResolvers<void>()
  let released = 0
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request): Promise<Response> => {
      if (request.method === 'PUT') {
        uploaded = new Uint8Array(await request.arrayBuffer())

        return new Response(null, { status: 200 })
      }
      if (new URL(request.url).pathname.endsWith('/download'))
        return Response.json({
          ...ready(groupId, fixture.length),
          files: [
            {
              ...ready(groupId, fixture.length).files[0],
              downloadUrl: `${server.url}object?signed=fixture-download`,
            },
          ],
        })

      return new Response(uploaded)
    },
  })

  try {
    await writeFile(path, fixture)
    const deps = await setup()
    const result = await dispatchLocalUpload('conversation-owner', 'd1', path, scope, {
      access,
      deps,
      transfers: {
        create: async (actualScope, direction, files) => {
          expect(actualScope).toEqual(scope)
          expect(direction).toBe('upload')
          expect(files[0]?.size).toBe(fixture.length)

          return created(groupId, `${server.url}object?signed=fixture-upload`)
        },
        finalize: async (actualScope, id) => {
          expect(actualScope).toEqual(scope)
          expect(id).toBe(groupId)
          expect(uploaded?.length).toBe(fixture.length)
          finalized.resolve()

          return ready(groupId, fixture.length)
        },
        release: async () => {
          released++
        },
      },
    })

    expect(result).toEqual({ groupId, fileName: 'fixture.bin', size: fixture.length })
    expect(JSON.stringify(result)).not.toContain('signed')
    const child = pull(groupId, join(dir, 'sandbox'), String(server.url))
    const output = await new Response(child.stdout).text()

    expect(await child.exited).toBe(0)
    // A delivered transfer keeps its slot once the stream has ended.
    await finalized.promise
    await Bun.sleep(20)
    expect(released).toBe(0)
    expect(output).not.toContain('signed')
    const pulled = await readFile(join(dir, 'sandbox', 'fixture.bin'))

    expect(pulled).toHaveLength(fixture.length)
    expect(createHash('sha256').update(pulled).digest('hex')).toBe(
      createHash('sha256').update(fixture).digest('hex'),
    )
  } finally {
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
})

// A transfer that outlasts a proxy's read timeout used to fail the tool call
// with a 504 although the upload itself went through.
test('the answer does not wait for the bytes, and the pull waits for them instead', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'device-upload-'))
  const groupId = new ObjectId().toHexString()
  const arrival = Promise.withResolvers<void>()
  let arrived = false
  let state: 'pending' | 'ready' = 'pending'
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request): Promise<Response> => {
      if (request.method === 'PUT') {
        await request.arrayBuffer()
        await arrival.promise
        arrived = true

        return new Response(null, { status: 200 })
      }
      if (!new URL(request.url).pathname.endsWith('/download')) return new Response('fixture')
      const view = ready(groupId, 7)

      const body = {
        ...view,
        status: state,
        files: [
          {
            ...view.files[0],
            status: state,
            ...(state === 'ready' ? { downloadUrl: `${server.url}object` } : {}),
          },
        ],
      }

      // Indented, as a backend other than ours might answer.
      return new Response(JSON.stringify(body, null, 2))
    },
  })

  try {
    await writeFile(join(dir, 'fixture.bin'), 'fixture')
    const deps = await setup()
    const result = await Promise.race([
      dispatchLocalUpload('conversation-owner', 'd1', join(dir, 'fixture.bin'), scope, {
        access,
        deps,
        // Bounds the wait for the transfer to exist, not the transfer itself.
        timeoutMs: 100,
        transfers: {
          create: async () => created(groupId, `${server.url}object`),
          finalize: async () => {
            expect(arrived).toBe(true)
            state = 'ready'

            return ready(groupId, 7)
          },
        },
      }),
      Bun.sleep(1000).then(() => 'waited for the transfer'),
    ])

    expect(result).toEqual({ groupId, fileName: 'fixture.bin', size: 7 })
    expect(arrived).toBe(false)
    const child = pull(groupId, join(dir, 'sandbox'), String(server.url))

    await Bun.sleep(500)
    arrival.resolve()
    expect(await child.exited).toBe(0)
    expect(await readFile(join(dir, 'sandbox', 'fixture.bin'), 'utf8')).toBe('fixture')
  } finally {
    arrival.resolve()
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
}, 20_000)

test('an upload that never reaches storage is reported as failed by the pull', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'device-upload-'))
  const groupId = new ObjectId().toHexString()
  const checked = Promise.withResolvers<void>()
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request): Response => {
      if (request.method === 'PUT') return new Response(null, { status: 500 })
      const view = ready(groupId, 7)

      return Response.json({
        ...view,
        status: 'failed',
        files: [{ ...view.files[0], status: 'failed' }],
      })
    },
  })

  try {
    await writeFile(join(dir, 'fixture.bin'), 'fixture')
    const deps = await setup()

    expect(
      await dispatchLocalUpload('conversation-owner', 'd1', join(dir, 'fixture.bin'), scope, {
        access,
        deps,
        transfers: {
          create: async () => created(groupId, `${server.url}object?signed=fixture-upload`),
          // The computer never asks to finalize; the backend checks storage itself.
          finalize: async (_scope, id) => {
            expect(id).toBe(groupId)
            checked.resolve()

            return { ...ready(groupId, 7), status: 'failed' as const }
          },
        },
      }),
    ).toEqual({ groupId, fileName: 'fixture.bin', size: 7 })
    await checked.promise
    const child = pull(groupId, join(dir, 'sandbox'), String(server.url))
    const errors = await new Response(child.stderr).text()

    expect(await child.exited).toBe(1)
    expect(errors).toContain('Upload failed (1): fixture.bin never reached storage')
    expect(errors).not.toContain('signed')
  } finally {
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
})

test('old computers and revoked membership never receive upload requests', async () => {
  for (const options of [{ capability: false }, { member: false }]) {
    const deps = await setup(options)

    expect(
      await dispatchLocalUpload('conversation-owner', 'd1', '/fixture', scope, { access, deps }),
    ).toEqual({ error: 'device_disconnected_or_update_required' })
    expect(deps.requests()).toBe(0)
    deps.tunnel.closed()
  }
})

test('someone who only uses the computer cannot read a file off it', async () => {
  const deps = await setup()

  await expect(
    dispatchLocalUpload('user', 'd1', '/fixture', scope, { access, deps }),
  ).rejects.toMatchObject({ status: 403 })
  expect(deps.requests()).toBe(0)
  deps.tunnel.closed()
})

test('a computer cannot finalize an unrelated group or return arbitrary errors', async () => {
  for (const reply of [
    { t: 'post', suffix: '/another-group/finalize' },
    { t: 'error', error: 'https://fixture.invalid/?signed=never-return' },
    { t: 'done', groupId: 'unverified-group' },
  ]) {
    const deps = await setup({ onData: (_data, send) => send(reply) })
    const result = await dispatchLocalUpload('conversation-owner', 'd1', '/fixture', scope, {
      access,
      deps,
    })

    expect('error' in result).toBe(true)
    expect(JSON.stringify(result)).not.toContain('signed')
    expect(JSON.stringify(result)).not.toContain('another-group')
    deps.tunnel.closed()
  }
})

const createIntent = {
  t: 'post',
  suffix: '',
  body: {
    direction: 'upload',
    files: [{ fileName: 'fixture', relPath: 'fixture', size: 1, contentType: null }],
  },
}

test('size and rate limits return only their known code', async () => {
  for (const [status, code] of [
    [413, 'file_too_large'],
    [429, 'file_transfer_rate_limited'],
  ] as const) {
    const deps = await setup({
      onData: (_data, send) =>
        send({
          t: 'post',
          suffix: '',
          body: {
            direction: 'upload',
            files: [{ fileName: 'fixture', relPath: 'fixture', size: 1, contentType: null }],
          },
        }),
    })

    expect(
      await dispatchLocalUpload('conversation-owner', 'd1', '/fixture', scope, {
        access,
        deps,
        transfers: {
          create: async () => {
            throw new AppError(status, code, 'signed=never-return')
          },
          finalize: async () => {
            throw new Error('must not finalize')
          },
        },
      }),
    ).toEqual({ error: code })
    deps.tunnel.closed()
  }
})

// The caller already has its answer, so the slot is given back in the background,
// and only once storage confirms the file is not there.
async function releasedAfter(options: {
  computer?: (message: { result?: unknown }, send: (value: unknown) => void) => void
  finalize: () => Promise<{ status: 'ready' | 'failed' }>
  create?: () => Promise<void>
  timeoutMs?: number
}) {
  const groupId = new ObjectId().toHexString()
  const releases: string[] = []
  const checks: string[] = []
  const deps = await setup({
    onData: (data, send) => {
      const message = JSON.parse(data) as { result?: unknown }

      if (!message.result) send(createIntent)
      else options.computer?.(message, send)
    },
  })
  const result = await dispatchLocalUpload('conversation-owner', 'd1', '/fixture', scope, {
    access,
    deps,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    transfers: {
      create: async () => {
        await options.create?.()

        return created(groupId, 'https://storage.invalid/object?signed=fixture-upload')
      },
      finalize: async (actualScope, id) => {
        expect(actualScope).toEqual(scope)
        checks.push(id)

        return { ...ready(groupId, 1), ...(await options.finalize()) }
      },
      release: async (actualScope, id) => {
        expect(actualScope).toEqual(scope)
        releases.push(id)
      },
    },
  })

  await Bun.sleep(50)

  return { groupId, result, releases, checks }
}

test('an upload whose file never arrives gives the slot back once', async () => {
  const { groupId, result, releases, checks } = await releasedAfter({
    // The PUT failed on the computer, then its stream ended.
    computer: (_message, send) => send({ t: 'error', error: 'upload_failed' }),
    finalize: async () => ({ status: 'failed' }),
  })

  expect(result).toEqual({ groupId, fileName: 'fixture', size: 1 })
  expect(checks).toEqual([groupId])
  expect(releases).toEqual([groupId])
})

test('a file that did arrive keeps its slot although the computer never confirmed it', async () => {
  const { releases, checks } = await releasedAfter({
    computer: (_message, send) => send({ t: 'error', error: 'upload_failed' }),
    finalize: async () => ({ status: 'ready' }),
  })

  expect(checks).toHaveLength(1)
  expect(releases).toEqual([])
})

test('a storage check that fails keeps the slot', async () => {
  const { releases, checks } = await releasedAfter({
    computer: (_message, send) => send({ t: 'error', error: 'upload_failed' }),
    finalize: async () => {
      throw new Error('storage unavailable')
    },
  })

  expect(checks).toHaveLength(1)
  expect(releases).toEqual([])
})

test('a confirmation that storage did not have the file gives the slot back once', async () => {
  const { groupId, releases, checks } = await releasedAfter({
    computer: (message, send) => {
      const created = message.result as { groupId?: string; status?: string }

      if (created.status === 'pending') send({ t: 'post', suffix: `/${created.groupId}/finalize` })
      else send({ t: 'done' })
    },
    finalize: async () => ({ status: 'failed' }),
  })

  expect(checks).toEqual([groupId])
  expect(releases).toEqual([groupId])
})

test('a transfer created after the caller timed out is checked and gives its slot back', async () => {
  const { groupId, result, releases, checks } = await releasedAfter({
    create: () => Bun.sleep(30),
    timeoutMs: 10,
    finalize: async () => ({ status: 'failed' }),
  })

  expect(result).toEqual({ error: 'upload_timeout' })
  expect(checks).toEqual([groupId])
  expect(releases).toEqual([groupId])
})

test('an upload refused before a transfer exists has nothing to give back', async () => {
  const deps = await setup({
    onData: (_data, send) => send({ t: 'error', error: 'file_not_found' }),
  })
  let released = 0
  const result = await dispatchLocalUpload('conversation-owner', 'd1', '/fixture', scope, {
    access,
    deps,
    transfers: {
      create: async () => {
        throw new Error('must not create')
      },
      finalize: async () => {
        throw new Error('must not finalize')
      },
      release: async () => {
        released++
      },
    },
  })

  expect(result).toEqual({ error: 'file_not_found' })
  await Bun.sleep(0)
  expect(released).toBe(0)
})

test('a stalled upload times out without replay', async () => {
  const deps = await setup({ onData: () => {} })

  expect(
    await dispatchLocalUpload('conversation-owner', 'd1', '/fixture', scope, {
      access,
      deps,
      timeoutMs: 20,
    }),
  ).toEqual({ error: 'upload_timeout' })
  expect(deps.requests()).toBe(1)
})
