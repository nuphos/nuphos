import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import {
  MAX_PAGES,
  applyDesignOps,
  assertDesignSize,
  designOpSchema,
  designPageSchema,
} from '@/lib/designs/ops'
import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { designs } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { Design, DesignPage } from '@/models'

export const designsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// Well above the HTML total a design may hold, so the size check below is what
// a too-large design hits, as a readable error.
designsRoutes.use('*', bodyLimit({ maxSize: 20 * 1024 * 1024 }))

const name = z.string().trim().min(1).max(100)

const createSchema = z.object({
  name: name.optional(),
  /** Start with these pages instead of one empty "Page 1". */
  pages: z.array(designPageSchema).min(1).max(MAX_PAGES).optional(),
})

/**
 * Replacing pages needs the `updatedAt` the caller last read: a design edited
 * since then answers 409 instead of losing those edits. A rename does not.
 */
export const replaceSchema = z
  .object({
    name: name.optional(),
    pages: z.array(designPageSchema).min(1).max(MAX_PAGES).optional(),
    updatedAt: z.string().datetime().optional(),
  })
  .strict()
  .refine((input) => input.pages === undefined || input.updatedAt !== undefined, {
    message: 'Replacing pages needs the updatedAt you last read; use ops for incremental edits',
    path: ['updatedAt'],
  })

const opsSchema = z.object({
  ops: z.array(designOpSchema).min(1).max(200),
})

// Only the server moves `updatedAt`, so a writer sending the value it last read
// learns about concurrent writes instead of silently overwriting them.
const WRITE_ATTEMPTS = 5

export function serializeDesign(doc: Design) {
  return {
    id: doc._id.toHexString(),
    teamId: doc.teamId.toHexString(),
    name: doc.name,
    pages: doc.pages,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

export function summarizeDesign(doc: Design) {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    pageCount: doc.pages.length,
    frameCount: doc.pages.reduce(
      (n, page) => n + page.objects.filter((o) => o.type === 'frame').length,
      0,
    ),
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

function notFound(designId: string): AppError {
  return new AppError(404, 'design_not_found', `Design ${designId} not found`)
}

function newPage(): DesignPage {
  return { id: new ObjectId().toHexString(), name: 'Page 1', objects: [], links: [] }
}

designsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const docs = await designs()
    .find({ teamId }, { projection: { 'pages.objects.html': 0 } })
    .sort({ updatedAt: -1 })
    .toArray()

  return c.json({ designs: docs.map(summarizeDesign) })
})

designsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR', 'EDITOR'),
  zv('json', createSchema),
  async (c) => {
    const input = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const now = new Date()
    const pages = (input.pages as DesignPage[] | undefined) ?? [newPage()]

    assertDesignSize(pages)
    const doc: Design = {
      _id: new ObjectId(),
      teamId,
      name: input.name ?? 'Untitled design',
      pages,
      createdBy: c.get('userId'),
      createdAt: now,
      updatedAt: now,
    }

    await designs().insertOne(doc)

    return c.json(serializeDesign(doc), 201)
  },
)

/** Only when it last changed: what a client polls to learn whether to fetch the rest. */
designsRoutes.get('/:designId/stamp', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const designId = parseObjectId(c.req.param('designId'), 'designId')
  const doc = await designs().findOne({ _id: designId, teamId }, { projection: { updatedAt: 1 } })

  if (!doc) throw notFound(c.req.param('designId'))

  return c.json({ updatedAt: doc.updatedAt.toISOString() })
})

designsRoutes.get('/:designId', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const designId = parseObjectId(c.req.param('designId'), 'designId')
  const doc = await designs().findOne({ _id: designId, teamId })

  if (!doc) throw notFound(c.req.param('designId'))

  return c.json(serializeDesign(doc))
})

/** Rename, or replace every page of a design the caller has just read. */
designsRoutes.put(
  '/:designId',
  requireTeamRole('ADMINISTRATOR', 'EDITOR'),
  zv('json', replaceSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const designId = parseObjectId(c.req.param('designId'), 'designId')
    const input = c.req.valid('json')
    const set: Partial<Design> = { updatedAt: new Date() }

    if (input.name !== undefined) set.name = input.name
    // Validated shapes match at runtime; the cast drops the `| null` that
    // .nullish() adds to optional fields.
    if (input.pages !== undefined) {
      assertDesignSize(input.pages as DesignPage[])
      set.pages = input.pages as DesignPage[]
    }

    const lock = input.updatedAt === undefined ? {} : { updatedAt: new Date(input.updatedAt) }
    const doc = await designs().findOneAndUpdate(
      { _id: designId, teamId, ...lock },
      { $set: set },
      { returnDocument: 'after' },
    )

    if (doc) return c.json(serializeDesign(doc))
    const exists = await designs().countDocuments({ _id: designId, teamId }, { limit: 1 })

    if (!exists) throw notFound(c.req.param('designId'))
    throw new AppError(
      409,
      'design_conflict',
      'The design changed since you read it; GET it again, or send ops instead',
    )
  },
)

/** Apply a batch of operations atomically against the current document. */
designsRoutes.post(
  '/:designId/ops',
  requireTeamRole('ADMINISTRATOR', 'EDITOR'),
  zv('json', opsSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const designId = parseObjectId(c.req.param('designId'), 'designId')
    const { ops } = c.req.valid('json')

    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const current = await designs().findOne({ _id: designId, teamId })

      if (!current) throw notFound(c.req.param('designId'))
      const next = applyDesignOps({ name: current.name, pages: current.pages }, ops)

      assertDesignSize(next.pages)
      const doc = await designs().findOneAndUpdate(
        { _id: designId, teamId, updatedAt: current.updatedAt },
        { $set: { name: next.name, pages: next.pages, updatedAt: new Date() } },
        { returnDocument: 'after' },
      )

      if (doc) return c.json(serializeDesign(doc))
    }
    throw new AppError(409, 'design_busy', 'The design is being edited; try again')
  },
)

designsRoutes.delete('/:designId', requireTeamRole('ADMINISTRATOR', 'EDITOR'), async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const designId = parseObjectId(c.req.param('designId'), 'designId')
  const result = await designs().deleteOne({ _id: designId, teamId })

  if (result.deletedCount === 0) throw notFound(c.req.param('designId'))

  return c.body(null, 204)
})
