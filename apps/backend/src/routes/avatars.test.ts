import { deflateSync } from 'node:zlib'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { ObjectId } from 'mongodb'

import { config } from '@/config'
import { errorHandler } from '@/lib/errors'
import { trustedAvatarURL } from '@/lib/identity/avatar-url'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'
import { useDb } from '@/lib/test/doubles/db'
import { auth } from '@/routes/auth'
import { avatarsRoutes } from '@/routes/avatars'

import type { AuthVariables } from '@/middleware/auth'
import type { Context, Next } from 'hono'

type Doc = Record<string, unknown>

const userId = new ObjectId()
let usersById: Map<string, Doc>
let avatars: Doc[]
// When set, the next users write waits on it: lets a test interleave two requests.
let gate: Promise<void> | null = null

const pathOf = (url: string) => url.slice(config.auth.publicBaseUrl.length)
const same = (a: unknown, b: unknown) => String(a) === String(b)

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([field, want]) => {
    const value = doc[field]

    if (want && typeof want === 'object' && !(want instanceof ObjectId)) {
      const op = want as { $ne?: unknown; $lt?: Date; $exists?: boolean }

      if ('$exists' in op) return (value !== undefined) === op.$exists
      if ('$ne' in op) return !same(value, op.$ne)
      if (op.$lt) return value instanceof Date && value < op.$lt
    }

    return same(value, want)
  })
}

function collection(name: string) {
  if (name === 'users') {
    return {
      findOne: (filter: Doc) => {
        const doc = usersById.get(String(filter._id))

        return Promise.resolve(doc && matches(doc, filter) ? doc : null)
      },
      findOneAndUpdate: async (filter: Doc, update: { $set: Doc }) => {
        if (gate) {
          const wait = gate

          gate = null
          await wait
        }
        const doc = usersById.get(String(filter._id))

        return doc ? Object.assign(doc, update.$set) : null
      },
      updateOne: () => Promise.resolve({}),
    }
  }
  if (name === 'user_avatars') {
    return {
      findOne: (filter: Doc) =>
        Promise.resolve(avatars.find((doc) => matches(doc, filter)) ?? null),
      updateOne: (filter: Doc, update: { $set: Doc }) => {
        const doc = avatars.find((d) => matches(d, filter))

        if (doc) Object.assign(doc, update.$set)
        else avatars.push({ ...filter, ...update.$set })

        return Promise.resolve({})
      },
      deleteMany: (filter: Doc) => {
        avatars = avatars.filter((doc) => !matches(doc, filter))

        return Promise.resolve({})
      },
    }
  }

  // No deletion request is open in these tests; the user directory write is a no-op.
  return { findOne: () => Promise.resolve(null), updateOne: () => Promise.resolve({}) }
}

useDb({ db: () => ({ collection }) })

useAuthMiddleware({
  requireAuth: async (c: Context<{ Variables: AuthVariables }>, next: Next) => {
    c.set('userId', userId.toHexString())
    await next()
  },
})

const app = new Hono()

app.route('/auth', auth)
app.route('/avatars', avatarsRoutes)
app.onError(errorHandler)

beforeEach(() => {
  usersById = new Map([
    [
      userId.toHexString(),
      {
        _id: userId,
        email: 'a@example.com',
        name: 'Alice',
        username: 'alice',
        avatarURL: 'https://lh3.googleusercontent.com/a',
        language: 'en',
        createdAt: new Date(),
      },
    ],
  ])
  avatars = []
  gate = null
})

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  const crc = Buffer.alloc(4)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])

  len.writeUInt32BE(data.length)
  crc.writeUInt32BE(Bun.hash.crc32(body))

  return Buffer.concat([len, body, crc])
}

/** A solid-colour RGB PNG; `declared` lets a test lie about the canvas size. */
function png(width: number, height: number, declared = { width, height }): Uint8Array {
  const header = Buffer.alloc(13)

  header.writeUInt32BE(declared.width, 0)
  header.writeUInt32BE(declared.height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7f)])
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const put = (body: Uint8Array) =>
  app.request('/auth/me/avatar', {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  })

test('an upload is re-encoded to a 256px WebP served at an immutable URL', async () => {
  const res = await put(png(600, 600))

  expect(res.status).toBe(200)
  const user = (await res.json()) as { avatarURL: string }
  const prefix = `${config.auth.publicBaseUrl}/avatars/${userId.toHexString()}/`

  expect(user.avatarURL.startsWith(prefix)).toBe(true)
  expect(usersById.get(userId.toHexString())?.profileEdited).toBe(true)
  expect(trustedAvatarURL(user.avatarURL)).toBe(user.avatarURL)

  const served = await app.request(user.avatarURL.slice(config.auth.publicBaseUrl.length))

  expect(served.status).toBe(200)
  expect(served.headers.get('content-type')).toBe('image/webp')
  expect(served.headers.get('cache-control')).toContain('immutable')
  expect(served.headers.get('x-content-type-options')).toBe('nosniff')
  const meta = await new Bun.Image(new Uint8Array(await served.arrayBuffer())).metadata()

  expect(meta).toEqual({ width: 256, height: 256, format: 'webp' })
})

test('a replaced avatar stops serving its old URL', async () => {
  const first = ((await (await put(png(300, 300))).json()) as { avatarURL: string }).avatarURL
  const second = ((await (await put(png(64, 64))).json()) as { avatarURL: string }).avatarURL

  expect(second).not.toBe(first)
  expect((await app.request(pathOf(first))).status).toBe(404)
  expect((await app.request(pathOf(second))).status).toBe(200)
})

test('uploads that are not PNG, JPEG or WebP are refused', async () => {
  const gif = new TextEncoder().encode('GIF89a\x01\x00\x01\x00\x00\x00\x00;')

  for (const body of [new TextEncoder().encode('<svg onload="x()"/>'), gif]) {
    const res = await put(body)

    expect(res.status).toBe(415)
  }
  expect(avatars).toHaveLength(0)
})

test('a tiny file declaring a huge canvas is refused before decoding', async () => {
  const res = await put(png(1, 1, { width: 100_000, height: 100_000 }))

  expect(res.status).toBe(415)
})

test('uploads over 2 MB are refused', async () => {
  const res = await put(new Uint8Array(2 * 1024 * 1024 + 1))

  expect(res.status).toBe(413)
})

test('removing the photo clears the URL and stops serving the image', async () => {
  const url = ((await (await put(png(64, 64))).json()) as { avatarURL: string }).avatarURL
  const res = await app.request('/auth/me/avatar', { method: 'DELETE' })

  expect(res.status).toBe(200)
  expect(((await res.json()) as { avatarURL: string }).avatarURL).toBe('')
  expect((await app.request(url.slice(config.auth.publicBaseUrl.length))).status).toBe(404)
})

test('the profile form cannot point at another account’s uploaded photo', async () => {
  const other = `${config.auth.publicBaseUrl}/avatars/${new ObjectId().toHexString()}/${'a'.repeat(64)}.webp`
  const res = await app.request('/auth/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Alice', username: 'alice', avatarURL: other }),
  })

  expect(res.status).toBe(400)
})

test('malformed avatar paths are 404s', async () => {
  for (const path of [
    `/avatars/not-an-id/${'a'.repeat(64)}.webp`,
    `/avatars/${userId.toHexString()}/${'a'.repeat(64)}.png`,
    `/avatars/${userId.toHexString()}/short.webp`,
  ]) {
    expect((await app.request(path)).status).toBe(404)
  }
})

const urlOf = async (res: Response | Promise<Response>) =>
  ((await (await res).json()) as { avatarURL: string }).avatarURL
const current = () => usersById.get(userId.toHexString())?.avatarURL

// Lets the gated request reach its users write before the other one runs.
async function untilStored(count: number) {
  while (avatars.length < count) await new Promise((resolve) => setTimeout(resolve, 1))
}

test('two uploads that interleave leave the published photo served', async () => {
  let release = () => {}

  gate = new Promise((resolve) => {
    release = resolve
  })
  // A stores its image, then waits before publishing its URL.
  const a = put(png(300, 300))

  await untilStored(1)
  // B stores, publishes and prunes in full meanwhile.
  const b = await urlOf(put(png(64, 64)))

  release()
  const urlA = await urlOf(a)

  // A published last, so A is the avatar, and its image is still there.
  expect(current()).toBe(urlA)
  expect((await app.request(pathOf(urlA))).status).toBe(200)
  // B is no longer the avatar, so it isn't served even though it is still stored.
  expect((await app.request(pathOf(b))).status).toBe(404)
})

test('an upload that interleaves with a removal keeps a consistent photo', async () => {
  let release = () => {}

  gate = new Promise((resolve) => {
    release = resolve
  })
  const a = put(png(300, 300))

  await untilStored(1)
  expect((await app.request('/auth/me/avatar', { method: 'DELETE' })).status).toBe(200)
  release()
  const urlA = await urlOf(a)

  expect(current()).toBe(urlA)
  expect((await app.request(pathOf(urlA))).status).toBe(200)
})

test('a superseded photo is deleted once it is past the grace window', async () => {
  await urlOf(put(png(300, 300)))
  for (const doc of avatars) doc.updatedAt = new Date(0)
  const latest = await urlOf(put(png(64, 64)))

  expect(avatars).toHaveLength(1)
  expect(latest.endsWith(`${String(avatars[0]?.hash)}.webp`)).toBe(true)
})
