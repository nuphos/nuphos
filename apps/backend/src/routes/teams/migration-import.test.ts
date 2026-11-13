import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { createMigrationArchive } from '@/lib/team-migration/archive'
import { MIGRATION_PARTS } from '@/lib/team-migration/format'

import { registerTeamImportRoutes } from './migration-import'

import type { AuthVariables } from '@/middleware/auth'

function app(signedIn = true, cli = false) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.onError(errorHandler)
  routes.use('*', async (c, next) => {
    c.set('userId', '000000000000000000000002')
    if (signedIn) c.set('sessionId', 'signed-in')
    if (cli) c.set('cliToken', {} as NonNullable<AuthVariables['cliToken']>)
    await next()
  })
  registerTeamImportRoutes(routes)

  return routes
}

function fixture() {
  const source = '000000000000000000000001'
  const archive = createMigrationArchive({
    format: 'nuphos-team',
    formatVersion: 1,
    backendVersion: 'test',
    sourceTeamId: source,
    exportedAt: new Date().toISOString(),
    parts: {},
    totals: { records: 0, bytes: 0 },
  })

  try {
    for (const name of MIGRATION_PARTS) {
      const part = archive.part(name)

      if (name === 'team.json')
        part.write({
          sourceTeamId: source,
          name: 'Imported team',
          allowedEmailDomains: ['example.com'],
          homeLayout: null,
        })
      else if (name === 'members.json' || name === 'not-migrated.json') part.write([])
      part.end()
    }

    return readFileSync(archive.finish().path)
  } finally {
    archive.dispose()
  }
}

test('import and preview require a signed-in user, not a CLI or conversation principal', async () => {
  for (const route of ['preview', 'import']) {
    for (const client of [app(false), app(true, true)]) {
      const response = await client.request(`/migration/${route}`, { method: 'POST' })

      expect(response.status).toBe(403)
    }
  }
})

test('preview verifies the ZIP and explains new-team and membership policy without writing', async () => {
  const response = await app().request('/migration/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: fixture(),
  })

  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toMatchObject({
    name: 'Imported team',
    createsNewTeam: true,
    members: [],
    memberPolicy: 'Only the importing user becomes a member; invite others afterwards',
  })
})

test('changed preview digest refuses import before any destination writes', async () => {
  const response = await app().request('/migration/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip', 'X-Migration-SHA256': 'wrong' },
    body: fixture(),
  })

  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({ error: { code: 'migration_preview_changed' } })
})

test('an existing team can never be selected as the import destination', async () => {
  const response = await app().request('/000000000000000000000001/migration/import', {
    method: 'POST',
  })

  expect(response.status).toBe(404)
})

test('non-ZIP uploads and oversized declared bodies are refused', async () => {
  expect((await app().request('/migration/preview', { method: 'POST', body: '{}' })).status).toBe(
    415,
  )
  expect(
    (
      await app().request('/migration/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip', 'Content-Length': String(101 * 1024 * 1024) },
        body: 'zip',
      })
    ).status,
  ).toBe(413)
})

test('a concurrent request from the same account is refused and the guard releases after failure', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let reading!: () => void
  const ready = new Promise<void>((resolve) => {
    reading = resolve
  })
  const body = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value
      },
      pull() {
        reading()
      },
    },
    { highWaterMark: 0 },
  )
  const routes = app()
  const first = routes.request('/migration/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body,
  })

  await ready
  expect((await routes.request('/migration/preview', { method: 'POST' })).status).toBe(429)
  controller.enqueue(new TextEncoder().encode('invalid ZIP'))
  controller.close()
  expect((await first).status).toBe(400)
  expect((await routes.request('/migration/preview', { method: 'POST' })).status).toBe(415)
})
