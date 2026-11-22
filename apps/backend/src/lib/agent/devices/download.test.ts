import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { AppError } from '@/lib/errors'

import { dispatchLocalDownload } from './download'
import { createLocalTunnelBus } from './local-runtime/bus'
import { attachRuntimeTunnel } from './local-runtime/holder'
import { createMemoryPresenceStore } from './local-runtime/presence'

import type { DeviceAccessDeps } from './box-access'
import type { RuntimeTunnel } from './local-runtime/holder'
import type { AgentDevice } from './store'
import type { TransferGroupView, TransferScope } from '@/lib/file-transfer/service'

// Imported dynamically, as in upload.test.ts: the host stream uses only Node's built-ins.
type HostStream = {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void
  send(data: string): void
  close(): void
}
const { LocalDownloadStream } = (await import(
  resolve('../desktop/electron/main/local-runtime/download-stream.ts')
)) as { LocalDownloadStream: new () => HostStream }

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
      userIds: ['conversation-owner'],
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
const dirs: string[] = []
const servers: { stop: (force: boolean) => Promise<void> }[] = []

afterEach(async () => {
  for (const tunnel of tunnels.splice(0)) tunnel.closed()
  for (const server of servers.splice(0)) await server.stop(true)
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** A computer whose tunnel runs the real host stream; `streams` counts the ones opened. */
async function computer(capability = true) {
  const bus = createLocalTunnelBus()
  const presence = createMemoryPresenceStore()
  let stream: HostStream | undefined
  let streams = 0
  const tunnel = await attachRuntimeTunnel(
    'computer-owner',
    'd1',
    {
      send: (frame) => {
        if (frame.t === 'open') {
          expect(frame.purpose).toBe('download')
          streams++
          stream = new LocalDownloadStream()
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
        if (frame.t === 'data') stream?.send(frame.d)
        if (frame.t === 'close') stream?.close()
      },
      close: () => {},
    },
    { bus, presence, isMember: async () => true, heartbeatMs: 60_000 },
  )

  tunnels.push(tunnel)
  tunnel.receive(
    JSON.stringify({
      t: 'status',
      status: { agents: {}, localExec: true, localDownload: capability },
    }),
  )
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await Promise.resolve()

  return { deps: { bus, presence }, streams: () => streams }
}

/** Storage serving `body` at a signed URL, and the group view that names it. */
function storage(
  body: string,
  files: { fileName: string; size?: number }[] = [{ fileName: 'deck.html' }],
) {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => new Response(body),
  })

  servers.push(server)
  const groupId = new ObjectId().toHexString()
  const view: TransferGroupView = {
    groupId,
    direction: 'download',
    status: 'ready',
    label: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    files: files.map((file) => ({
      id: file.fileName,
      fileName: file.fileName,
      relPath: file.fileName,
      size: file.size ?? body.length,
      contentType: null,
      status: 'ready',
      downloadUrl: `${String(server.url)}object?signed=fixture-download`,
    })),
  }
  const transfers = {
    resolve: async (actualScope: TransferScope, id: string) => {
      expect(actualScope).toEqual(scope)
      if (id !== groupId) throw new AppError(404, 'transfer_not_found', 'File transfer not found')

      return view
    },
  }

  return { groupId, transfers }
}

async function folder() {
  const dir = await mkdtemp(join(tmpdir(), 'device-download-'))

  dirs.push(dir)

  return dir
}

test('the computer fetches the file itself, and the signed URL never reaches the caller', async () => {
  const dir = await folder()
  const { deps } = await computer()
  const { groupId, transfers } = storage('<html>deck</html>')
  const path = join(dir, 'deck.html')
  const result = await dispatchLocalDownload('conversation-owner', 'd1', { groupId, path }, scope, {
    access,
    deps,
    transfers,
  })

  expect(result).toEqual({ path, size: 17 })
  expect(JSON.stringify(result)).not.toContain('signed')
  expect(await readFile(path, 'utf8')).toBe('<html>deck</html>')
  expect(await readdir(dir)).toEqual(['deck.html'])
})

test('an existing file is kept unless the agent asks to overwrite it', async () => {
  const dir = await folder()
  const { deps } = await computer()
  const { groupId, transfers } = storage('new')
  const path = join(dir, 'deck.html')

  await writeFile(path, 'old')
  const refused = await dispatchLocalDownload(
    'conversation-owner',
    'd1',
    { groupId, path },
    scope,
    { access, deps, transfers },
  )

  expect(refused).toEqual({ error: 'file_exists' })
  expect(await readFile(path, 'utf8')).toBe('old')
  const replaced = await dispatchLocalDownload(
    'conversation-owner',
    'd1',
    { groupId, path, overwrite: true },
    scope,
    { access, deps, transfers },
  )

  expect(replaced).toEqual({ path, size: 3 })
  expect(await readFile(path, 'utf8')).toBe('new')
  expect(await readdir(dir)).toEqual(['deck.html'])
})

test('a body shorter than the stored size leaves no file behind', async () => {
  const dir = await folder()
  const { deps } = await computer()
  const { groupId, transfers } = storage('short', [{ fileName: 'deck.html', size: 50 }])
  const result = await dispatchLocalDownload(
    'conversation-owner',
    'd1',
    { groupId, path: join(dir, 'deck.html') },
    scope,
    { access, deps, transfers },
  )

  expect(result).toEqual({ error: 'download_failed' })
  expect(await readdir(dir)).toEqual([])
})

test('a missing folder and a relative path are refused before anything is fetched', async () => {
  const dir = await folder()
  const { deps } = await computer()
  const { groupId, transfers } = storage('x')

  for (const [path, error] of [
    [join(dir, 'missing', 'deck.html'), 'directory_not_found'],
    ['deck.html', 'absolute_path_required'],
  ] as const) {
    expect(
      await dispatchLocalDownload('conversation-owner', 'd1', { groupId, path }, scope, {
        access,
        deps,
        transfers,
      }),
    ).toEqual({ error })
  }
})

test('a computer on an older Nuphos is told to update, without opening a stream', async () => {
  const dir = await folder()
  const { deps, streams } = await computer(false)
  const { groupId, transfers } = storage('x')
  const result = await dispatchLocalDownload(
    'conversation-owner',
    'd1',
    { groupId, path: join(dir, 'deck.html') },
    scope,
    { access, deps, transfers },
  )

  expect(result).toEqual({ error: 'update_required' })
  expect(streams()).toBe(0)
})

test('a group of several files needs the one to save named', async () => {
  const dir = await folder()
  const { deps } = await computer()
  const { groupId, transfers } = storage('same', [{ fileName: 'a.txt' }, { fileName: 'b.txt' }])
  const options = { access, deps, transfers }

  expect(
    await dispatchLocalDownload(
      'conversation-owner',
      'd1',
      { groupId, path: join(dir, 'a.txt') },
      scope,
      options,
    ),
  ).toEqual({ error: 'file_name_required' })
  expect(
    await dispatchLocalDownload(
      'conversation-owner',
      'd1',
      { groupId, fileName: 'b.txt', path: join(dir, 'b.txt') },
      scope,
      options,
    ),
  ).toEqual({ path: join(dir, 'b.txt'), size: 4 })
  expect(
    await dispatchLocalDownload(
      'conversation-owner',
      'd1',
      { groupId: new ObjectId().toHexString(), path: join(dir, 'c.txt') },
      scope,
      options,
    ),
  ).toEqual({ error: 'transfer_not_found' })
})
