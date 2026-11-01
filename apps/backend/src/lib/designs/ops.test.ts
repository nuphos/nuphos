import { describe, expect, test } from 'bun:test'

import { applyDesignOps } from '@/lib/designs/ops'

import type { DesignFrame, DesignPage } from '@/models/designs'

const frame = (id: string, x = 0): DesignFrame => ({
  id,
  type: 'frame',
  title: id,
  x,
  y: 0,
  width: 390,
  height: 844,
  html: '<h1>hi</h1>',
})

const page = (
  id: string,
  objects: DesignPage['objects'] = [],
  links: DesignPage['links'] = [],
) => ({
  id,
  name: id,
  objects,
  links,
})

describe('applyDesignOps', () => {
  test('upsert keeps the order of existing objects and appends new ones', () => {
    const doc = { name: 'd', pages: [page('p1', [frame('a'), frame('b')])] }
    const next = applyDesignOps(doc, [
      { op: 'upsertObjects', pageId: 'p1', objects: [frame('b', 100), frame('c')] },
    ])

    expect(next.pages[0]!.objects.map((o) => o.id)).toEqual(['a', 'b', 'c'])
    expect(next.pages[0]!.objects[1]!.x).toBe(100)
  })

  test('deleting a frame drops the links that pointed at it', () => {
    const doc = {
      name: 'd',
      pages: [page('p1', [frame('a'), frame('b')], [{ id: 'l', source: 'a', target: 'b' }])],
    }
    const next = applyDesignOps(doc, [{ op: 'deleteObjects', pageId: 'p1', objectIds: ['b'] }])

    expect(next.pages[0]!.links).toEqual([])
  })

  test('a link to a missing frame is not stored', () => {
    const doc = { name: 'd', pages: [page('p1', [frame('a')])] }
    const next = applyDesignOps(doc, [
      { op: 'upsertLinks', pageId: 'p1', links: [{ id: 'l', source: 'a', target: 'zz' }] },
    ])

    expect(next.pages[0]!.links).toEqual([])
  })

  test('pages are added after a given page and the last page cannot go', () => {
    const doc = { name: 'd', pages: [page('p1'), page('p3')] }
    const next = applyDesignOps(doc, [
      { op: 'addPage', page: { id: 'p2', name: 'Two' }, after: 'p1' },
    ])

    expect(next.pages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(() =>
      applyDesignOps({ name: 'd', pages: [page('p1')] }, [{ op: 'deletePage', pageId: 'p1' }]),
    ).toThrow()
  })

  test('reorder keeps unmentioned pages at the end in their old order', () => {
    const doc = { name: 'd', pages: [page('a'), page('b'), page('c'), page('d')] }
    const next = applyDesignOps(doc, [{ op: 'reorderPages', pageIds: ['c', 'a', 'nope'] }])

    expect(next.pages.map((p) => p.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  test('rename and renamePage change only names', () => {
    const doc = { name: 'd', pages: [page('p1')] }
    const next = applyDesignOps(doc, [
      { op: 'rename', name: 'Checkout' },
      { op: 'renamePage', pageId: 'p1', name: 'Mobile' },
    ])

    expect(next.name).toBe('Checkout')
    expect(next.pages[0]!.name).toBe('Mobile')
    expect(() => applyDesignOps(doc, [{ op: 'renamePage', pageId: 'zz', name: 'x' }])).toThrow()
  })
})
