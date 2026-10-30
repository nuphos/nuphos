import { genId } from './helpers'

import type { DesignLink, DesignObject } from '../schema'

// One clipboard for every open design in this window; copying a frame in one
// design and pasting it into another is the point.
let clipboard: { objects: DesignObject[]; links: DesignLink[] } = { objects: [], links: [] }

const PASTE_OFFSET = 32

export function copyObjects(objects: DesignObject[], links: DesignLink[]) {
  const ids = new Set(objects.map((o) => o.id))

  clipboard = {
    objects: structuredClone(objects),
    links: structuredClone(links.filter((l) => ids.has(l.source) && ids.has(l.target))),
  }
}

export function hasClipboard(): boolean {
  return clipboard.objects.length > 0
}

/** Fresh ids, shifted a little so the copies are visibly new. */
export function cloneObjects(
  objects: DesignObject[],
  links: DesignLink[],
  offset = PASTE_OFFSET,
): { objects: DesignObject[]; links: DesignLink[] } {
  const idMap = new Map(objects.map((o) => [o.id, genId()]))
  // Objects are immutable plain JSON; a shallow copy is a new object already.
  const copies = objects.map((o) => ({
    ...o,
    ...(o.type === 'ink' ? { points: o.points.map(([x, y]) => [x, y] as [number, number]) } : {}),
    id: idMap.get(o.id)!,
    x: o.x + offset,
    y: o.y + offset,
  }))
  const linkCopies = links
    .filter((l) => idMap.has(l.source) && idMap.has(l.target))
    .map((l) => ({ ...l, id: genId(), source: idMap.get(l.source)!, target: idMap.get(l.target)! }))

  return { objects: copies, links: linkCopies }
}

export function pasteObjects(): { objects: DesignObject[]; links: DesignLink[] } {
  const pasted = cloneObjects(clipboard.objects, clipboard.links)

  // Paste again and the next copy lands further along, not on top of the last.
  clipboard = {
    objects: clipboard.objects.map((o) => ({ ...o, x: o.x + PASTE_OFFSET, y: o.y + PASTE_OFFSET })),
    links: clipboard.links,
  }

  return pasted
}
