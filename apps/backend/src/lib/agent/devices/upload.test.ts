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

test('6 MiB shared-computer upload and pull preserve SHA-256 without exposing capabilities', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'device-upload-'))
  const fixture = Buffer.alloc(6 * 1024 * 1024, 42)
  const path = join(dir, 'fixture.bin')
  let uploaded: Uint8Array | undefined
  const groupId = new ObjectId().toHexString()
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

          return {
            groupId,
            direction,
            status: 'pending',
            expiresAt: new Date().toISOString(),
            files: [
              {
                id: 'file',
                fileName: 'fixture.bin',
                relPath: 'fixture.bin',
                uploadUrl: `${server.url}object?signed=fixture-upload`,
                expiresAt: new Date().toISOString(),
              },
            ],
          }
        },
        finalize: async (actualScope, id) => {
          expect(actualScope).toEqual(scope)
          expect(id).toBe(groupId)
          expect(uploaded?.length).toBe(fixture.length)

          return ready(groupId, fixture.length)
        },
      },
    })

    expect(result).toEqual({ groupId, fileName: 'fixture.bin', size: fixture.length })
    expect(JSON.stringify(result)).not.toContain('signed')
    const child = Bun.spawn(
      [
        'bash',
        resolve('src/lib/agent/builtin-skills/skills/file-transfer/scripts/transfer-pull.sh'),
        teamId.toHexString(),
        groupId,
        join(dir, 'sandbox'),
      ],
      {
        env: {
          ...process.env,
          OPENAB_CREDENTIALS_DIR: '',
          NUPHOS_BACKEND_URL: String(server.url),
          NUPHOS_TOKEN: 'non-secret-fixture',
          NUPHOS_SESSION_ID: scope.sessionId,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const output = await new Response(child.stdout).text()

    expect(await child.exited).toBe(0)
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

test('size-limit failures return only a known code', async () => {
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
          throw new AppError(413, 'file_too_large', 'signed=never-return')
        },
        finalize: async () => {
          throw new Error('must not finalize')
        },
      },
    }),
  ).toEqual({ error: 'file_too_large' })
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
