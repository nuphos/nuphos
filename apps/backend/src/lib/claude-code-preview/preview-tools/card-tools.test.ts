import { describe, expect, test } from 'bun:test'

import { cardTools } from './index'

const names = (sets: Record<string, Record<string, unknown>>) =>
  Object.values(sets).flatMap((tools) => Object.keys(tools))

describe('chart and artifact tools', () => {
  test('a Task gets both, as its conversation draws their cards', () => {
    expect(names(cardTools({}))).toEqual(['render_chart', 'render_artifact'])
  })

  // #5272: a Bot's chat shows only its posts, so the card it was told was open never showed.
  test('a Bot gets neither', () => {
    expect(names(cardTools({ bot: true }))).toEqual([])
  })
})
