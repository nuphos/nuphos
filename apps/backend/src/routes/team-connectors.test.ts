import { describe, expect, test } from 'bun:test'

import { connectorViews } from '@/routes/team-connectors'

describe('connectorViews', () => {
  test('skips a binding whose view throws instead of failing the whole listing', () => {
    const views = connectorViews('posthog', [{ ok: 1 }, { ok: 0 }, { ok: 2 }], (item) => {
      if (!item.ok) throw new TypeError('legacy document')

      return item.ok
    })

    expect(views).toEqual([1, 2])
  })

  test('treats a missing collection as empty', () => {
    expect(connectorViews('posthog', undefined, (item: number) => item)).toEqual([])
  })
})
