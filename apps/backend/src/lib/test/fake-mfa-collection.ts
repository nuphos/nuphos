import { ObjectId } from 'mongodb'

/** Just the Mongo the two-factor code uses, in memory, for its tests. */
export type Doc = Record<string, unknown>

// Through arrays as Mongo does: `mfa.passkeys.id` is every passkey's id.
const get = (doc: Doc, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (v, k) =>
        Array.isArray(v) ? v.map((item) => (item as Doc)[k]) : (v as Doc | undefined)?.[k],
      doc,
    )

function set(doc: Doc, path: string, value: unknown) {
  const keys = path.split('.')
  const last = keys.pop()!
  let parent = doc

  for (const key of keys) {
    parent[key] ??= {}
    parent = parent[key] as Doc
  }

  if (value === undefined) delete parent[last]
  else parent[last] = value
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([path, expected]) => {
    if (path === '$or') return (expected as Doc[]).some((f) => matches(doc, f))
    const value = get(doc, path)

    if (expected instanceof ObjectId) return String(value) === expected.toHexString()
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const op = expected as Doc

      if ('$exists' in op) return (value !== undefined) === op.$exists
      if ('$ne' in op) return Array.isArray(value) ? !value.includes(op.$ne) : value !== op.$ne
      if ('$lt' in op) return (value as number) < (op.$lt as number)
      if ('$lte' in op) return value instanceof Date && value <= (op.$lte as Date)
      if ('$gt' in op) return value instanceof Date && value > (op.$gt as Date)
    }
    if (Array.isArray(value)) return value.includes(expected)

    return value === expected
  })
}

export class FakeCollection {
  docs: Doc[] = []
  async insertOne(doc: Doc) {
    this.docs.push(structuredClone(doc))

    return { insertedId: doc._id }
  }
  async findOne(filter: Doc) {
    const hit = this.docs.find((d) => matches(d, filter))

    return hit ? structuredClone(hit) : null
  }
  async findOneAndDelete(filter: Doc) {
    const hit = this.docs.find((d) => matches(d, filter))

    this.docs = this.docs.filter((d) => d !== hit)

    return hit ?? null
  }
  async findOneAndUpdate(filter: Doc, update: Record<string, Doc>) {
    const hit = this.docs.find((d) => matches(d, filter))

    if (hit) await this.updateOne({ _id: hit._id }, update)

    return hit ? structuredClone(hit) : null
  }
  async updateOne(filter: Doc, update: Record<string, Doc>) {
    // Yield first, as a round trip would, so parallel requests interleave.
    await Promise.resolve()
    const hit = this.docs.find((d) => matches(d, filter))

    if (!hit) return { matchedCount: 0, modifiedCount: 0 }
    for (const [path, value] of Object.entries(update.$set ?? {})) {
      // `list.$.field`: the element the filter matched on `list.<key>`.
      if (path.includes('.$.')) {
        const [list, field] = path.split('.$.') as [string, string]
        const [key, wanted] = Object.entries(filter).find(([k]) => k.startsWith(`${list}.`))!
        const element = (get(hit, list) as Doc[]).find(
          (e) => e[key.slice(list.length + 1)] === wanted,
        )!

        element[field] = value
      } else set(hit, path, value)
    }
    for (const [path, value] of Object.entries(update.$push ?? {})) {
      set(hit, path, [...((get(hit, path) as unknown[] | undefined) ?? []), value])
    }
    for (const path of Object.keys(update.$unset ?? {})) set(hit, path, undefined)
    for (const [path, by] of Object.entries(update.$inc ?? {})) {
      set(hit, path, (get(hit, path) as number) + (by as number))
    }
    for (const [path, value] of Object.entries(update.$pull ?? {})) {
      set(
        hit,
        path,
        (get(hit, path) as unknown[]).filter((v) =>
          value && typeof value === 'object' ? !matches(v as Doc, value as Doc) : v !== value,
        ),
      )
    }

    return { matchedCount: 1, modifiedCount: 1 }
  }
  async deleteMany(filter: Doc) {
    const before = this.docs.length

    this.docs = this.docs.filter((d) => !matches(d, filter))

    return { deletedCount: before - this.docs.length }
  }
  find() {
    const cursor = { limit: () => cursor, toArray: async () => [] }

    return cursor
  }
}
