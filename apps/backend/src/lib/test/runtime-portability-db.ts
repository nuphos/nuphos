// Small Mongo fixture for the lifecycle state machine, including positional
// updates (by `placements.id` or a top-level $elemMatch) and duplicate-key
// behavior used by the placement lease.
type Doc = Record<string, any>
const valueAt = (doc: Doc, key: string): any =>
  key.split('.').reduce((value, part) => value?.[part], doc)

function matches(doc: Doc, query: Doc): boolean {
  return Object.entries(query).every(([key, expected]) => {
    if (key === '$or') return expected.some((part: Doc) => matches(doc, part))
    if (key.startsWith('placements.'))
      return doc.placements?.some((entry: Doc) => matches(entry, { [key.slice(11)]: expected }))
    const actual = valueAt(doc, key)

    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('$elemMatch' in expected)
        return (
          Array.isArray(actual) && actual.some((entry: Doc) => matches(entry, expected.$elemMatch))
        )
      if ('$exists' in expected) return (actual !== undefined) === expected.$exists
      if ('$lte' in expected) return actual <= expected.$lte
      if ('$gt' in expected) return actual > expected.$gt
      if ('$ne' in expected)
        return Array.isArray(actual) ? !actual.includes(expected.$ne) : actual !== expected.$ne
      if ('$in' in expected) return expected.$in.includes(actual)
    }

    return Array.isArray(actual) ? actual.includes(expected) : actual === expected
  })
}
function update(doc: Doc, query: Doc, mutation: Doc) {
  // Like Mongo, `$` names the element the query matched, before any $set changes it.
  const positional = new Map<string, Doc>()

  for (const [key, value] of Object.entries(mutation.$set ?? {})) {
    const parts = key.split('.')
    let parent = doc
    let arrayKey = ''

    while (parts.length > 1) {
      const part = parts.shift()!

      if (part === '$') {
        const element = query[arrayKey]?.$elemMatch

        if (!positional.has(arrayKey))
          positional.set(
            arrayKey,
            parent.find((entry: Doc) =>
              element ? matches(entry, element) : entry.id === query['placements.id'],
            ),
          )
        parent = positional.get(arrayKey)!
      } else {
        arrayKey = part
        parent[part] ??= {}
        parent = parent[part]
      }
    }
    parent[parts[0]!] = value
  }
  for (const key of Object.keys(mutation.$unset ?? {})) {
    const [head = key, tail] = key.split('.')

    if (tail === undefined) delete doc[key]
    else if (doc[head]) delete doc[head][tail]
  }
  for (const [key, value] of Object.entries<number>(mutation.$max ?? {})) {
    const [head = key, tail] = key.split('.')

    if (tail === undefined) doc[key] = Math.max(Number(doc[key] ?? value), value)
    else {
      doc[head] ??= {}
      doc[head][tail] = Math.max(Number(doc[head][tail] ?? value), value)
    }
  }
  for (const [key, value] of Object.entries<number>(mutation.$inc ?? {}))
    doc[key] = Number(doc[key] ?? 0) + value
  for (const [key, value] of Object.entries<Doc>(mutation.$addToSet ?? {})) {
    doc[key] ??= []
    const values = value && typeof value === 'object' && '$each' in value ? value.$each : [value]

    for (const entry of values) if (!doc[key].includes(entry)) doc[key].push(entry)
  }
  for (const [key, value] of Object.entries<Doc>(mutation.$push ?? {})) {
    doc[key] ??= []
    if (!value || typeof value !== 'object' || !('$each' in value)) doc[key].push(value)
    else {
      doc[key].push(...value.$each)
      if (value.$slice !== undefined) doc[key] = doc[key].slice(value.$slice)
    }
  }
  for (const [key, value] of Object.entries<Doc>(mutation.$pull ?? {})) {
    const drop = (entry: unknown) =>
      value && typeof value === 'object' && '$in' in value
        ? value.$in.includes(entry)
        : entry === value

    doc[key] = (doc[key] ?? []).filter((entry: unknown) => !drop(entry))
  }
}
export function portabilityDb() {
  const stores = new Map<string, Doc[]>()
  const rows = (name: string) => {
    if (!stores.has(name)) stores.set(name, [])

    return stores.get(name)!
  }
  const collection = (name: string) => ({
    find: (query: Doc) => {
      let docs = () => rows(name).filter((doc) => matches(doc, query))
      // Rows come back in insertion order; the fixtures insert them in the order wanted.
      const cursor = {
        toArray: async () => docs(),
        project: () => cursor,
        sort: () => cursor,
        limit: (count: number) => {
          const unlimited = docs

          docs = () => unlimited().slice(0, count)

          return cursor
        },
      }

      return cursor
    },
    insertOne: async (doc: Doc) => {
      // The unique { teamId, hostedSlot } index on hosted runtimes.
      if (
        typeof doc.hostedSlot === 'number' &&
        rows(name).some((row) => row.teamId === doc.teamId && row.hostedSlot === doc.hostedSlot)
      )
        throw Object.assign(new Error('Duplicate key'), { code: 11000 })
      rows(name).push(doc)

      return { insertedId: doc._id }
    },
    findOne: async (query: Doc) => rows(name).find((doc) => matches(doc, query)) ?? null,
    countDocuments: async (query: Doc) => rows(name).filter((doc) => matches(doc, query)).length,
    findOneAndUpdate: async (query: Doc, mutation: Doc, options?: Doc) => {
      let doc = rows(name).find((entry) => matches(entry, query))

      if (!doc && options?.upsert) {
        if (rows(name).some((entry) => entry._id === query._id))
          throw Object.assign(new Error('Duplicate key'), { code: 11000 })
        const created: Doc = { _id: query._id, ...mutation.$setOnInsert }

        rows(name).push(created)
        doc = created
      }
      if (doc) update(doc, query, mutation)

      return doc ?? null
    },
    updateOne: async (query: Doc, mutation: Doc, options?: Doc) => {
      const doc = await collection(name).findOneAndUpdate(query, mutation, options)

      return { matchedCount: doc ? 1 : 0, modifiedCount: doc ? 1 : 0 }
    },
    updateMany: async (query: Doc, mutation: Doc) => {
      const matched = rows(name).filter((doc) => matches(doc, query))

      for (const doc of matched) update(doc, query, mutation)

      return { matchedCount: matched.length, modifiedCount: matched.length }
    },
    deleteMany: async (query: Doc) => {
      const kept = rows(name).filter((doc) => !matches(doc, query))
      const deletedCount = rows(name).length - kept.length

      stores.set(name, kept)

      return { deletedCount }
    },
    deleteOne: async (query: Doc) => {
      const index = rows(name).findIndex((doc) => matches(doc, query))

      if (index >= 0) rows(name).splice(index, 1)

      return { deletedCount: index >= 0 ? 1 : 0 }
    },
  })

  return { rows, collection }
}
