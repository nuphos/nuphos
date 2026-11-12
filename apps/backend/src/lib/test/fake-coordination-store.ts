type Row = Record<string, any>

function valueAt(row: Row, key: string): unknown {
  return key.split('.').reduce<any>((value, part) => value?.[part], row)
}

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$and') return value.every((entry: Row) => matches(row, entry))
    if (key === '$or') return value.some((entry: Row) => matches(row, entry))
    const actual = valueAt(row, key)

    if (value instanceof RegExp) return typeof actual === 'string' && value.test(actual)
    if (Array.isArray(value)) return JSON.stringify(actual) === JSON.stringify(value)

    if (value && typeof value === 'object' && !(value instanceof Date)) {
      return Object.entries(value).every(([op, expected]) => {
        if (op === '$exists') return (actual !== undefined) === expected
        if (op === '$ne') return actual !== expected
        if (op === '$type') return typeof actual === expected
        if (op === '$lt') return (actual as Date) < (expected as Date)
        if (op === '$lte') return (actual as Date) <= (expected as Date)

        throw new Error(`Unsupported fake query ${op}`)
      })
    }

    return actual === value
  })
}

/** Bounded Mongo operations used by coordination; unsupported queries fail loudly. */
export class FakeCoordinationStore {
  rows: Record<string, Row[]> = {}
  collection = (name: string) => {
    this.rows[name] ??= []
    const rows = this.rows[name]
    const found = (query: Row) => rows.filter((row) => matches(row, query))

    return {
      findOne: async (query: Row) => found(query)[0] ?? null,
      find: (query: Row) => {
        let result = found(query)
        const cursor = {
          sort: (spec: Record<string, number>) => {
            const first = Object.entries(spec)[0]

            if (!first) return cursor
            const [field, direction] = first

            result.sort((a, b) => {
              if (a[field] < b[field]) return -direction
              if (a[field] > b[field]) return direction

              return 0
            })

            return cursor
          },
          limit: (count: number) => {
            result = result.slice(0, count)

            return cursor
          },
          toArray: async () => result,
        }

        return cursor
      },
      updateOne: async (query: Row, update: Row, options?: { upsert?: boolean }) => {
        let row = found(query)[0]
        const existed = Boolean(row)

        if (!row && options?.upsert) {
          row = { ...query, ...update.$setOnInsert }
          rows.push(row!)
        }
        if (row) {
          Object.assign(row, update.$set)
          for (const key of Object.keys(update.$unset ?? {})) delete row[key]
        }

        return { matchedCount: existed ? 1 : 0 }
      },
    }
  }
}
