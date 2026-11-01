// How a design changes: a list of small operations applied to its pages. Desktop
// and the agent both send these, so two writers editing different objects on the
// same page never overwrite each other's work the way a whole-document PUT would.
// Mirrored by apps/desktop/src/design/designOps.ts, which skips instead of throwing.
import { z } from 'zod'

import { AppError } from '@/lib/errors'

import type { DesignLink, DesignObject, DesignPage } from '@/models/designs'

const id = z.string().min(1).max(64)
const num = z.number().finite()
const base = { id, x: num, y: num }

// Optional fields use .nullish(): the MongoDB driver can persist an absent field
// as null, and the desktop's autosave sends what it read back.
export const designObjectSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('frame'),
    title: z.string().max(200),
    width: num.min(1),
    height: num.min(1),
    html: z.string().max(400_000),
    sourceArtifact: z
      .object({ sessionId: z.string(), artifactId: z.string(), version: z.number().int() })
      .nullish(),
  }),
  z.object({
    ...base,
    type: z.literal('section'),
    title: z.string().max(200),
    width: num.min(1),
    height: num.min(1),
    color: z.string().max(32).nullish(),
  }),
  z.object({
    ...base,
    type: z.literal('text'),
    text: z.string().max(10_000),
    width: num.min(1),
    fontSize: num.min(6).max(400).nullish(),
    color: z.string().max(32).nullish(),
  }),
  z.object({
    ...base,
    type: z.literal('note'),
    text: z.string().max(10_000),
    width: num.min(1),
    height: num.min(1),
    color: z.string().max(32).nullish(),
  }),
  z.object({
    ...base,
    type: z.literal('ink'),
    width: num.min(0),
    height: num.min(0),
    points: z.array(z.tuple([num, num])).max(5000),
    color: z.string().max(32).nullish(),
    strokeWidth: num.min(0.5).max(64).nullish(),
  }),
  z.object({
    ...base,
    type: z.literal('shape'),
    shape: z.enum(['rect', 'ellipse', 'arrow', 'line']),
    // A line or arrow runs from (x, y) to (x + width, y + height), so either may be negative.
    width: num,
    height: num,
    color: z.string().max(32).nullish(),
    text: z.string().max(2000).nullish(),
  }),
])

export const designLinkSchema = z.object({
  id,
  source: id,
  target: id,
  label: z.string().max(200).nullish(),
})

export const designPageSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  objects: z.array(designObjectSchema).max(2000),
  links: z.array(designLinkSchema).max(5000),
})

export const designOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('rename'), name: z.string().trim().min(1).max(100) }),
  z.object({
    op: z.literal('addPage'),
    page: z.object({ id, name: z.string().trim().min(1).max(100) }),
    /** Insert after this page; at the end when absent. */
    after: id.nullish(),
  }),
  z.object({ op: z.literal('renamePage'), pageId: id, name: z.string().trim().min(1).max(100) }),
  z.object({ op: z.literal('deletePage'), pageId: id }),
  z.object({ op: z.literal('reorderPages'), pageIds: z.array(id).max(200) }),
  z.object({
    op: z.literal('upsertObjects'),
    pageId: id,
    objects: z.array(designObjectSchema).max(500),
  }),
  z.object({ op: z.literal('deleteObjects'), pageId: id, objectIds: z.array(id).max(2000) }),
  z.object({ op: z.literal('upsertLinks'), pageId: id, links: z.array(designLinkSchema).max(500) }),
  z.object({ op: z.literal('deleteLinks'), pageId: id, linkIds: z.array(id).max(5000) }),
])

export type DesignOp = z.infer<typeof designOpSchema>

export const MAX_PAGES = 100
// Keeps a design well inside MongoDB's 16 MB document limit.
export const MAX_HTML_BYTES = 12 * 1024 * 1024

export function assertDesignSize(pages: DesignPage[]): void {
  let total = 0

  for (const page of pages) {
    for (const o of page.objects) if (o.type === 'frame') total += o.html.length
  }
  if (total > MAX_HTML_BYTES) {
    throw new AppError(
      400,
      'design_too_large',
      'This design holds too much HTML; split it across designs',
    )
  }
}

type Doc = { name: string; pages: DesignPage[] }

function pageOrThrow(pages: DesignPage[], pageId: string): DesignPage {
  const page = pages.find((p) => p.id === pageId)

  if (!page) throw new AppError(404, 'design_page_not_found', `Page ${pageId} not found`)

  return page
}

function replacePage(pages: DesignPage[], next: DesignPage): DesignPage[] {
  return pages.map((p) => (p.id === next.id ? next : p))
}

/** Replace by id, keep order for existing entries, append new ones. */
function upsert<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(incoming.map((item) => [item.id, item]))
  const kept = current.map((item) => byId.get(item.id) ?? item)
  const seen = new Set(current.map((item) => item.id))

  return [...kept, ...incoming.filter((item) => !seen.has(item.id))]
}

/** A link is only meaningful between two frames that still exist on the page. */
function validLinks(objects: DesignObject[], links: DesignLink[]): DesignLink[] {
  const frames = new Set(objects.filter((o) => o.type === 'frame').map((o) => o.id))

  return links.filter((l) => frames.has(l.source) && frames.has(l.target))
}

export function applyDesignOp(doc: Doc, op: DesignOp): Doc {
  switch (op.op) {
    case 'rename':
      return { ...doc, name: op.name }
    case 'addPage': {
      if (doc.pages.some((p) => p.id === op.page.id)) {
        throw new AppError(409, 'design_page_exists', `Page ${op.page.id} already exists`)
      }
      if (doc.pages.length >= MAX_PAGES) {
        throw new AppError(
          400,
          'design_too_many_pages',
          `A design holds at most ${String(MAX_PAGES)} pages`,
        )
      }
      const page: DesignPage = { id: op.page.id, name: op.page.name, objects: [], links: [] }
      const at = op.after ? doc.pages.findIndex((p) => p.id === op.after) : -1
      const pages =
        at >= 0
          ? [...doc.pages.slice(0, at + 1), page, ...doc.pages.slice(at + 1)]
          : [...doc.pages, page]

      return { ...doc, pages }
    }
    case 'renamePage': {
      const page = pageOrThrow(doc.pages, op.pageId)

      return { ...doc, pages: replacePage(doc.pages, { ...page, name: op.name }) }
    }
    case 'deletePage': {
      pageOrThrow(doc.pages, op.pageId)
      if (doc.pages.length === 1) {
        throw new AppError(400, 'design_last_page', 'A design keeps at least one page')
      }

      return { ...doc, pages: doc.pages.filter((p) => p.id !== op.pageId) }
    }
    case 'reorderPages': {
      const known = new Map(doc.pages.map((p) => [p.id, p]))
      const ordered = op.pageIds.flatMap((pid) => {
        const page = known.get(pid)

        if (!page) return []
        known.delete(pid)

        return [page]
      })

      // Pages the caller did not mention keep their relative order at the end.
      return { ...doc, pages: [...ordered, ...doc.pages.filter((p) => known.has(p.id))] }
    }
    case 'upsertObjects': {
      const page = pageOrThrow(doc.pages, op.pageId)
      const objects = upsert(page.objects, op.objects as DesignObject[])

      return {
        ...doc,
        pages: replacePage(doc.pages, { ...page, objects, links: validLinks(objects, page.links) }),
      }
    }
    case 'deleteObjects': {
      const page = pageOrThrow(doc.pages, op.pageId)
      const gone = new Set(op.objectIds)
      const objects = page.objects.filter((o) => !gone.has(o.id))

      return {
        ...doc,
        pages: replacePage(doc.pages, { ...page, objects, links: validLinks(objects, page.links) }),
      }
    }
    case 'upsertLinks': {
      const page = pageOrThrow(doc.pages, op.pageId)
      const links = validLinks(page.objects, upsert(page.links, op.links as DesignLink[]))

      return { ...doc, pages: replacePage(doc.pages, { ...page, links }) }
    }
    case 'deleteLinks': {
      const page = pageOrThrow(doc.pages, op.pageId)
      const gone = new Set(op.linkIds)

      return {
        ...doc,
        pages: replacePage(doc.pages, {
          ...page,
          links: page.links.filter((l) => !gone.has(l.id)),
        }),
      }
    }
  }
}

export function applyDesignOps(doc: Doc, ops: DesignOp[]): Doc {
  return ops.reduce(applyDesignOp, doc)
}
