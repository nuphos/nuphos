import assert from 'node:assert/strict'
import test from 'node:test'

import { comboParts } from './platform.ts'
import { SHORTCUT_GROUPS } from './shortcutsCatalog.ts'

const allCombos = SHORTCUT_GROUPS.flatMap((group) =>
  group.entries.flatMap((entry) => entry.combos.map((combo) => ({ label: entry.label, combo }))),
)

test('every catalog combo renders through comboParts on both platforms', () => {
  for (const { label, combo } of allCombos) {
    for (const mac of [true, false]) {
      const parts = comboParts(combo, mac)

      assert.ok(parts.length > 0, `${label}: empty parts for ${combo}`)
      for (const part of parts) {
        assert.ok(part.length > 0, `${label}: blank part in ${combo}`)
        // A multi-char lowercase part means a token fell through the map
        // unrecognised (e.g. a typo like 'mdo+t').
        assert.ok(
          part.length === 1 || part !== part.toLowerCase(),
          `${label}: unmapped token "${part}" in ${combo}`,
        )
      }
    }
  }
})

test('no duplicate combos within the catalog except deliberate esc reuse', () => {
  const seen = new Map<string, string>()

  for (const { label, combo } of allCombos) {
    if (combo === 'esc') continue // esc legitimately closes several things
    const prior = seen.get(combo)

    assert.equal(prior, undefined, `combo ${combo} used by both "${prior}" and "${label}"`)
    seen.set(combo, label)
  }
})
