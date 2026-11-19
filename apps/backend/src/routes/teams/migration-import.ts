import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'
import { MIGRATION_LIMITS } from '@/lib/team-migration/format'
import { importTeam } from '@/lib/team-migration/import'
import { importedRows } from '@/lib/team-migration/records'
import { validateTeamArchive } from '@/lib/team-migration/validate'

import type { AuthVariables } from '@/middleware/auth'
import type { Context, Hono } from 'hono'

const inFlight = new Set<string>()

const sourceMember = z.string().regex(/^[a-f0-9]{24}$/)

async function readZip(request: Request): Promise<Buffer> {
  if (!request.headers.get('Content-Type')?.startsWith('application/zip'))
    throw new AppError(415, 'zip_required', 'Upload a team ZIP archive')
  const length = Number(request.headers.get('Content-Length') ?? 0)

  if (length > MIGRATION_LIMITS.compressedBytes)
    throw new AppError(413, 'migration_limit', 'ZIP exceeds 100 MiB')
  const reader = request.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined

  if (!reader) throw new AppError(400, 'zip_required', 'Upload a team ZIP archive')
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    while (true) {
      const { value, done } = await reader.read()

      if (done) break
      size += value.byteLength
      if (size > MIGRATION_LIMITS.compressedBytes)
        throw new AppError(413, 'migration_limit', 'ZIP exceeds 100 MiB')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }

  return Buffer.concat(chunks)
}

// Static root routes: import cannot accept an existing destination team id.
export function registerTeamImportRoutes(routes: Hono<{ Variables: AuthVariables }>) {
  routes.use('/migration/*', async (c, next) => {
    if (!c.get('sessionId') || c.get('cliToken'))
      throw new AppError(403, 'user_session_required', 'Sign in to import a team archive')
    const userId = c.get('userId')

    if (inFlight.has(userId))
      throw new AppError(
        429,
        'migration_busy',
        'A migration request is already running for this account',
      )
    if (inFlight.size >= 2)
      throw new AppError(
        503,
        'migration_busy',
        'This server is processing other migration requests; try again shortly',
      )
    inFlight.add(userId)
    try {
      await next()
    } finally {
      inFlight.delete(userId)
    }
  })
  const handler =
    (action: 'preview' | 'import') => async (c: Context<{ Variables: AuthVariables }>) => {
      if (!c.get('sessionId') || c.get('cliToken'))
        throw new AppError(403, 'user_session_required', 'Sign in to import a team archive')
      const archive = await validateTeamArchive(await readZip(c.req.raw))

      try {
        c.header('Cache-Control', 'no-store')
        if (action === 'preview') {
          let members: unknown = []
          let settings: Record<string, unknown> = {}
          let excluded: unknown = []

          for await (const row of importedRows(archive.paths.get('members.json')!)) members = row
          for await (const row of importedRows(archive.paths.get('team.json')!)) settings = row
          for await (const row of importedRows(archive.paths.get('not-migrated.json')!))
            excluded = row

          return c.json({
            sha256: archive.digest,
            manifest: archive.manifest,
            name: settings.name,
            members,
            excluded,
            createsNewTeam: true,
            memberPolicy: 'Only the importing user becomes a member; invite others afterwards',
            reset: [
              'email-domain auto-join',
              'local computer sharing',
              'trigger enablement',
              'dashboard refresh schedules',
              'runtime sessions and credentials',
            ],
          })
        }
        if (c.req.header('X-Migration-SHA256') !== archive.digest)
          throw new AppError(
            409,
            'migration_preview_changed',
            'Preview this exact archive before importing',
          )
        const rawSelf = c.req.header('X-Migration-Source-Member')
        const self = rawSelf ? sourceMember.safeParse(rawSelf) : null

        if (self && !self.success)
          throw new AppError(400, 'invalid_member_mapping', 'Invalid source member')
        const result = await importTeam(
          archive,
          c.get('userId'),
          self?.success ? self.data : undefined,
        )

        logEvent('info', 'team.migration.imported', {
          team_id: result.team.id,
          user_id: c.get('userId'),
          sha256: archive.digest,
        })

        return c.json(result, 201)
      } finally {
        archive.dispose()
      }
    }

  routes.post('/migration/preview', handler('preview'))
  routes.post('/migration/import', handler('import'))
}
