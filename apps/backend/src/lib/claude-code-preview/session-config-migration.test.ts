import { expect, test } from 'bun:test'

import { migrateConfirmedSessionConfig } from './session-config-migration'
import { parseSessionConfigOptions } from './session-config-options'

type Doc = Record<string, unknown>
const at = (doc: Doc, path: string) =>
  path.split('.').reduce<unknown>((value, key) => (value as Doc | undefined)?.[key], doc)
const matches = (doc: Doc, filter: Doc) =>
  Object.entries(filter).every(([path, want]) => {
    const value = at(doc, path)

    if (want && typeof want === 'object' && '$exists' in want)
      return (value !== undefined) === (want as { $exists: boolean }).$exists

    return JSON.stringify(value) === JSON.stringify(want)
  })

// Enough of a collection for the backfill: find by filter, compare-and-set update.
function collection(docs: Doc[]) {
  return {
    find: (filter: Doc) => ({
      toArray: async () => structuredClone(docs.filter((d) => matches(d, filter))),
    }),
    updateOne: async (filter: Doc, update: { $set: Doc; $unset: Doc }) => {
      const doc = docs.find((d) => matches(d, filter))
      const preview = doc?.claudeCodePreview as Doc | undefined

      if (!preview) return
      preview.runtimeDefaults = update.$set['claudeCodePreview.runtimeDefaults']
      delete preview.sessionConfig
    },
  }
}
const model = (currentValue: string) => ({
  id: 'model',
  name: 'Model',
  category: 'model',
  currentValue,
  options: [
    { value: 'a', name: 'A' },
    { value: 'b', name: 'B' },
    { value: 'c', name: 'C' },
  ],
})

test('a stale replica cannot overwrite a pick confirmed after the backfill', async () => {
  const docs: Doc[] = [
    {
      sessionId: 's',
      teamId: 't',
      claudeCodePreview: {
        openabSessionId: 'o',
        runtimeDefaults: { model: 'a' },
        sessionConfig: parseSessionConfigOptions([model('b')]),
      },
    },
  ]
  const live = collection(docs)
  // Replica B reads its snapshot before replica A migrates.
  const stale = await live.find({ 'claudeCodePreview.sessionConfig': { $exists: true } }).toArray()

  expect(await migrateConfirmedSessionConfig(live as never)).toBe(1)
  expect(docs[0]?.claudeCodePreview).toEqual({
    openabSessionId: 'o',
    runtimeDefaults: { model: 'b' },
  })
  // A user then confirms c; B's write from its stale snapshot must not undo it.
  ;(docs[0]?.claudeCodePreview as Doc).runtimeDefaults = { model: 'c' }
  await migrateConfirmedSessionConfig({
    ...live,
    find: () => ({ toArray: async () => stale }),
  } as never)
  expect((docs[0]?.claudeCodePreview as Doc).runtimeDefaults).toEqual({ model: 'c' })
  // Once migrated there is nothing left to do.
  expect(await migrateConfirmedSessionConfig(live as never)).toBe(0)
})
