// File-transfer routes. Mounted twice with the same handlers:
//   - team-scoped (Desktop):  /teams/:teamId/file-transfers
//   - agent-scoped (sandbox): /agent-sessions/:sid/teams/:teamId/file-transfers
//
// The agent mount injects `transferSessionId` so groups created from a turn
// are scoped to that conversation; the team mount leaves it undefined.

import { Hono } from 'hono'
import { z } from 'zod'

import {
  createTransfer,
  finalizeTransfer,
  getTransferGroup,
  listTransferGroups,
  resolveDownloads,
} from '@/lib/file-transfer/service'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamMember } from '@/middleware/auth'

import type { TransferScope } from '@/lib/file-transfer/service'
import type { TeamAuthVariables } from '@/middleware/auth'

export type FileTransferVariables = TeamAuthVariables & {
  // Set by the agent-session mount; undefined for team-level (Desktop) calls.
  transferSessionId?: string
}

const fileIntentSchema = z.object({
  fileName: z.string().trim().min(1).max(512),
  relPath: z.string().trim().min(1).max(1024).optional(),
  size: z.number().int().positive(),
  contentType: z.string().trim().min(1).max(255).nullish(),
})

const createSchema = z
  .object({
    direction: z.enum(['upload', 'download']),
    label: z.string().trim().min(1).max(255).optional(),
    files: z.array(fileIntentSchema).min(1),
  })
  .strict()

export const fileTransfersRoutes = new Hono<{ Variables: FileTransferVariables }>()
fileTransfersRoutes.use('*', requireTeamMember())

function scopeOf(c: {
  get: <K extends keyof FileTransferVariables>(k: K) => FileTransferVariables[K]
}): TransferScope {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const userId = c.get('userId')
  const sessionId = c.get('transferSessionId')

  return { teamId, userId, ...(sessionId ? { sessionId } : {}) }
}

// Create a transfer group + presigned PUT URLs (producer side).
fileTransfersRoutes.post('/', zv('json', createSchema), async (c) => {
  const { direction, files, label } = c.req.valid('json')
  const result = await createTransfer(scopeOf(c), direction, files, label)

  return c.json(result, 201)
})

// List download groups for this scope (e.g. files an agent produced in the
// conversation). Must be declared before '/:groupId' so "downloads" isn't
// parsed as a group id.
fileTransfersRoutes.get('/downloads', async (c) => {
  const groups = await listTransferGroups(scopeOf(c), 'download')

  return c.json({ groups })
})

// Confirm produced objects exist; set per-file + group status.
fileTransfersRoutes.post('/:groupId/finalize', async (c) => {
  const result = await finalizeTransfer(scopeOf(c), c.req.param('groupId'))

  return c.json(result)
})

// Group metadata + per-file status (no download URLs).
fileTransfersRoutes.get('/:groupId', async (c) => {
  const result = await getTransferGroup(scopeOf(c), c.req.param('groupId'))

  return c.json(result)
})

// Presigned GET URLs for every ready file (consumer side).
fileTransfersRoutes.get('/:groupId/download', async (c) => {
  const result = await resolveDownloads(scopeOf(c), c.req.param('groupId'))

  return c.json(result)
})
