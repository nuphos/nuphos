import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

import { AppError } from '@/lib/errors'
import { logEvent } from '@/lib/observability'
import { exportTeam } from '@/lib/team-migration/export'
import { requireTeamRole } from '@/middleware/auth'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Hono } from 'hono'

export function registerTeamMigrationRoutes(routes: Hono<{ Variables: TeamAuthVariables }>) {
  routes.post('/migration/export', requireTeamRole('ADMINISTRATOR'), async (c) => {
    if (!c.get('sessionId') || c.get('cliToken'))
      throw new AppError(
        403,
        'user_session_required',
        'Sign in as a team administrator to export team data',
      )
    const teamId = c.get('teamId')
    const actorId = c.get('userId')

    try {
      const archive = await exportTeam(teamId)
      const stream = createReadStream(archive.path)

      stream.once('close', archive.dispose)
      logEvent('info', 'team.migration.exported', {
        team_id: teamId,
        user_id: actorId,
        sha256: archive.sha256,
        records: archive.digest.totals.records,
        bytes: archive.bytes,
      })

      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Length': String(archive.bytes),
          'Content-Disposition': 'attachment; filename="nuphos-team.zip"',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch (error) {
      logEvent('warn', 'team.migration.export_failed', { team_id: teamId, user_id: actorId })
      throw error
    }
  })
}
