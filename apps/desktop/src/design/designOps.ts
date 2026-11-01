// The desktop's copy of the backend's op reducer, so a merge can replay local
// edits onto a newer remote document without a round trip. Unlike the server,
// an op that no longer applies (its page is gone) is skipped, not an error.
import type { Design, DesignLink, DesignObject, DesignOp, DesignPage } from './schema'

type Doc = Pick<Design, 'name' | 'pages'>

function upsert<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(incoming.map((item) => [item.id, item]))
  const kept = current.map((item) => byId.get(item.id) ?? item)
  const seen = new Set(current.map((item) => item.id))

  return [...kept, ...incoming.filter((item) => !seen.has(item.id))]
}

function validLinks(objects: DesignObject[], links: DesignLink[]): DesignLink[] {
  const frames = new Set(objects.filter((o) => o.type === 'frame').map((o) => o.id))

  return links.filter((l) => frames.has(l.source) && frames.has(l.target))
}

function withPage(doc: Doc, pageId: string, fn: (page: DesignPage) => DesignPage): Doc {
  if (!doc.pages.some((p) => p.id === pageId)) return doc

  return { ...doc, pages: doc.pages.map((p) => (p.id === pageId ? fn(p) : p)) }
}

export function applyDesignOp<T extends Doc>(doc: T, op: DesignOp): T {
  switch (op.op) {
    case 'rename':
      return { ...doc, name: op.name }
    case 'addPage': {
      if (doc.pages.some((p) => p.id === op.page.id)) return doc
      const page: DesignPage = { id: op.page.id, name: op.page.name, objects: [], links: [] }
      const at = op.after ? doc.pages.findIndex((p) => p.id === op.after) : -1
      const pages =
        at >= 0
          ? [...doc.pages.slice(0, at + 1), page, ...doc.pages.slice(at + 1)]
          : [...doc.pages, page]

      return { ...doc, pages }
    }
    case 'renamePage':
      return withPage(doc, op.pageId, (p) => ({ ...p, name: op.name })) as T
    case 'deletePage':
      return doc.pages.length > 1
        ? { ...doc, pages: doc.pages.filter((p) => p.id !== op.pageId) }
        : doc
    case 'reorderPages': {
      const known = new Map(doc.pages.map((p) => [p.id, p]))
      const ordered = op.pageIds.flatMap((id) => {
        const page = known.get(id)

        if (!page) return []
        known.delete(id)

        return [page]
      })

      return { ...doc, pages: [...ordered, ...doc.pages.filter((p) => known.has(p.id))] }
    }
    case 'upsertObjects':
      return withPage(doc, op.pageId, (p) => {
        const objects = upsert(p.objects, op.objects)

        return { ...p, objects, links: validLinks(objects, p.links) }
      }) as T
    case 'deleteObjects':
      return withPage(doc, op.pageId, (p) => {
        const gone = new Set(op.objectIds)
        const objects = p.objects.filter((o) => !gone.has(o.id))

        return { ...p, objects, links: validLinks(objects, p.links) }
      }) as T
    case 'upsertLinks':
      return withPage(doc, op.pageId, (p) => ({
        ...p,
        links: validLinks(p.objects, upsert(p.links, op.links)),
      })) as T
    case 'deleteLinks':
      return withPage(doc, op.pageId, (p) => {
        const gone = new Set(op.linkIds)

        return { ...p, links: p.links.filter((l) => !gone.has(l.id)) }
      }) as T
  }
}

export function applyDesignOps<T extends Doc>(doc: T, ops: DesignOp[]): T {
  return ops.reduce(applyDesignOp, doc)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const UPSERT_CHUNK = 500

function diffById<T extends { id: string }>(
  before: T[],
  after: T[],
): { upserts: T[]; deletes: string[] } {
  const was = new Map(before.map((item) => [item.id, item]))
  // Objects are immutable here: an untouched one keeps its reference, so most
  // comparisons never reach the serialisation.
  const upserts = after.filter((item) => {
    const prev = was.get(item.id)

    return !prev || (prev !== item && !same(prev, item))
  })
  const now = new Set(after.map((item) => item.id))
  const deletes = before.filter((item) => !now.has(item.id)).map((item) => item.id)

  return { upserts, deletes }
}

/** The ops that turn `base` into `local`: what this client changed since it last synced. */
export function diffDesignOps(base: Doc, local: Doc): DesignOp[] {
  const ops: DesignOp[] = []

  if (base.name !== local.name) ops.push({ op: 'rename', name: local.name })
  const basePages = new Map(base.pages.map((p) => [p.id, p]))
  const localIds = new Set(local.pages.map((p) => p.id))

  for (const page of base.pages) {
    if (!localIds.has(page.id)) ops.push({ op: 'deletePage', pageId: page.id })
  }
  local.pages.forEach((page, index) => {
    const before = basePages.get(page.id)

    if (!before) {
      const previous = local.pages[index - 1]

      ops.push({
        op: 'addPage',
        page: { id: page.id, name: page.name },
        after: previous ? previous.id : null,
      })
    } else if (before.name !== page.name) {
      ops.push({ op: 'renamePage', pageId: page.id, name: page.name })
    }
    const objects = diffById(before?.objects ?? [], page.objects)
    const links = diffById(before?.links ?? [], page.links)

    if (objects.deletes.length) {
      ops.push({ op: 'deleteObjects', pageId: page.id, objectIds: objects.deletes })
    }
    // The server takes at most UPSERT_CHUNK objects per op.
    for (let i = 0; i < objects.upserts.length; i += UPSERT_CHUNK) {
      ops.push({
        op: 'upsertObjects',
        pageId: page.id,
        objects: objects.upserts.slice(i, i + UPSERT_CHUNK),
      })
    }
    if (links.deletes.length)
      ops.push({ op: 'deleteLinks', pageId: page.id, linkIds: links.deletes })
    for (let i = 0; i < links.upserts.length; i += UPSERT_CHUNK) {
      ops.push({
        op: 'upsertLinks',
        pageId: page.id,
        links: links.upserts.slice(i, i + UPSERT_CHUNK),
      })
    }
  })
  const baseOrder = base.pages.filter((p) => localIds.has(p.id)).map((p) => p.id)
  const localOrder = local.pages.filter((p) => basePages.has(p.id)).map((p) => p.id)

  if (!same(baseOrder, localOrder))
    ops.push({ op: 'reorderPages', pageIds: local.pages.map((p) => p.id) })

  return ops
}

/**
 * Three-way merge for an external edit (the agent, a teammate): the remote
 * document with this client's unsynced changes replayed on top, so neither
 * side's work is lost. Object-level: the same object edited on both sides keeps
 * the local version until it syncs.
 */
export function mergeDesign(base: Design, local: Design, remote: Design): Design {
  return applyDesignOps(remote, diffDesignOps(base, local))
}
