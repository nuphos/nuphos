import { Hono } from 'hono'
import { ObjectId } from 'mongodb'
import { z } from 'zod'

import { AppError } from '@/lib/errors'
import { parseObjectId } from '@/lib/objectid'
import { zv } from '@/lib/validate'
import { requireTeamRole } from '@/middleware/auth'
import { architectureDiagrams } from '@/models'

import type { TeamAuthVariables } from '@/middleware/auth'
import type { ArchitectureDiagram } from '@/models'

export const architectureDiagramsRoutes = new Hono<{ Variables: TeamAuthVariables }>()

// Optional fields use .nullish() (accept null AND undefined): the MongoDB driver
// can persist an absent (undefined) field as null, so agent-written data that
// round-trips back through the desktop's autosave arrives with explicit nulls.
const diagramNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.string().nullish(),
  position: z.object({ x: z.number(), y: z.number() }),
  size: z.object({ width: z.number(), height: z.number() }).nullish(),
  url: z.string().nullish(),
})

const diagramEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().nullish(),
  offset: z.number().nullish(),
})

const nodeStyleSchema = z.object({
  hidden: z.boolean().nullish(),
  color: z.string().nullish(),
})

const diagramViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  edges: z.array(diagramEdgeSchema),
  nodeStyles: z.record(nodeStyleSchema).nullish(),
})

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
})

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    nodes: z.array(diagramNodeSchema).optional(),
    views: z.array(diagramViewSchema).optional(),
  })
  .strict()

function serializeDiagram(doc: ArchitectureDiagram) {
  return {
    id: doc._id.toHexString(),
    teamId: doc.teamId.toHexString(),
    name: doc.name,
    nodes: doc.nodes,
    views: doc.views,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  }
}

architectureDiagramsRoutes.get('/', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const docs = await architectureDiagrams().find({ teamId }).sort({ updatedAt: -1 }).toArray()

  return c.json({
    diagrams: docs.map((doc) => ({
      id: doc._id.toHexString(),
      name: doc.name,
      nodeCount: doc.nodes.length,
      viewCount: doc.views.length,
      updatedAt: doc.updatedAt.toISOString(),
    })),
  })
})

architectureDiagramsRoutes.post(
  '/',
  requireTeamRole('ADMINISTRATOR', 'EDITOR'),
  zv('json', createSchema),
  async (c) => {
    const { name } = c.req.valid('json')
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const now = new Date()
    const doc: ArchitectureDiagram = {
      _id: new ObjectId(),
      teamId,
      name,
      nodes: [],
      views: [{ id: new ObjectId().toHexString(), name: 'Structure', edges: [] }],
      createdAt: now,
      updatedAt: now,
    }

    await architectureDiagrams().insertOne(doc)

    return c.json(serializeDiagram(doc), 201)
  },
)

architectureDiagramsRoutes.get('/:diagramId', async (c) => {
  const teamId = parseObjectId(c.get('teamId'), 'teamId')
  const diagramId = parseObjectId(c.req.param('diagramId'), 'diagramId')
  const doc = await architectureDiagrams().findOne({ _id: diagramId, teamId })

  if (!doc) {
    throw new AppError(404, 'diagram_not_found', `Diagram ${c.req.param('diagramId')} not found`)
  }

  return c.json(serializeDiagram(doc))
})

architectureDiagramsRoutes.put(
  '/:diagramId',
  requireTeamRole('ADMINISTRATOR', 'EDITOR'),
  zv('json', updateSchema),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const diagramId = parseObjectId(c.req.param('diagramId'), 'diagramId')
    const input = c.req.valid('json')

    const set: Partial<ArchitectureDiagram> = { updatedAt: new Date() }

    if (input.name !== undefined) set.name = input.name
    // Validated shapes match at runtime; the casts only drop the `| null` that
    // .nullish() adds to optional fields (see schema note above).
    if (input.nodes !== undefined) set.nodes = input.nodes as ArchitectureDiagram['nodes']
    if (input.views !== undefined) set.views = input.views as ArchitectureDiagram['views']

    const doc = await architectureDiagrams().findOneAndUpdate(
      { _id: diagramId, teamId },
      { $set: set },
      { returnDocument: 'after' },
    )

    if (!doc) {
      throw new AppError(404, 'diagram_not_found', `Diagram ${c.req.param('diagramId')} not found`)
    }

    return c.json(serializeDiagram(doc))
  },
)

architectureDiagramsRoutes.delete(
  '/:diagramId',
  requireTeamRole('ADMINISTRATOR', 'EDITOR'),
  async (c) => {
    const teamId = parseObjectId(c.get('teamId'), 'teamId')
    const diagramId = parseObjectId(c.req.param('diagramId'), 'diagramId')
    const result = await architectureDiagrams().deleteOne({ _id: diagramId, teamId })

    if (result.deletedCount === 0) {
      throw new AppError(404, 'diagram_not_found', `Diagram ${c.req.param('diagramId')} not found`)
    }

    return c.body(null, 204)
  },
)
