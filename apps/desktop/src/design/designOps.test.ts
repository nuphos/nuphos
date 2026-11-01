import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyDesignOps, diffDesignOps, mergeDesign } from './designOps.ts'

import type { Design, DesignFrame, DesignNote, DesignPage } from './schema.ts'

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
const note = (id: string, text = 'todo'): DesignNote => ({
  id,
  type: 'note',
  text,
  x: 0,
  y: 0,
  width: 200,
  height: 200,
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
const design = (pages: DesignPage[], name = 'd', updatedAt = '1'): Design => ({
  id: 'x',
  teamId: 't',
  name,
  pages,
  createdBy: 'u',
  createdAt: '0',
  updatedAt,
})

test('no difference means no ops', () => {
  const d = design([page('p', [frame('a')])])

  assert.deepEqual(diffDesignOps(d, d), [])
})

test('a moved frame becomes one upsert; a removed one a delete', () => {
  const base = design([page('p', [frame('a'), frame('b')])])
  const local = design([page('p', [frame('a', 300)])])

  assert.deepEqual(diffDesignOps(base, local), [
    { op: 'deleteObjects', pageId: 'p', objectIds: ['b'] },
    { op: 'upsertObjects', pageId: 'p', objects: [frame('a', 300)] },
  ])
})

test('pages added, renamed, removed and reordered round-trip through ops', () => {
  const base = design([page('p1'), page('p2')])
  const local = design([{ ...page('p2'), name: 'Two' }, page('p1'), page('p3', [note('n')])])
  const ops = diffDesignOps(base, local)

  assert.deepEqual(applyDesignOps(base, ops).pages, local.pages)
})

test('merge keeps the agent frame and the local move', () => {
  const base = design([page('p', [frame('a')])])
  const local = design([page('p', [frame('a', 500)])])
  const remote = design([page('p', [frame('a'), frame('agent')])], 'd', '2')
  const merged = mergeDesign(base, local, remote)

  assert.deepEqual(
    merged.pages[0]!.objects.map((o) => [o.id, o.x]),
    [
      ['a', 500],
      ['agent', 0],
    ],
  )
  assert.equal(merged.updatedAt, '2')
})

test('merge drops a local edit to an object the remote deleted only if untouched', () => {
  const base = design([page('p', [note('n'), note('m')])])
  const local = design([page('p', [note('n', 'edited'), note('m')])])
  const remote = design([page('p', [])], 'd', '2')
  const merged = mergeDesign(base, local, remote)

  // n was edited here, so it comes back; m was untouched and stays deleted.
  assert.deepEqual(
    merged.pages[0]!.objects.map((o) => o.id),
    ['n'],
  )
})

test('a local edit on a page the remote removed is skipped', () => {
  const base = design([page('p1'), page('p2')])
  const local = design([page('p1'), page('p2', [note('n')])])
  const remote = design([page('p1')], 'd', '2')

  assert.deepEqual(
    mergeDesign(base, local, remote).pages.map((p) => p.id),
    ['p1'],
  )
})
