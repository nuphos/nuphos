import type { MongoReadQuery } from '@/lib/database-query/types'

const FORBIDDEN_OPERATORS = new Set(['$where', '$function', '$accumulator', '$out', '$merge'])
const READ_ONLY_PIPELINE_STAGES = new Set([
  '$addFields',
  '$count',
  '$facet',
  '$group',
  '$limit',
  '$lookup',
  '$match',
  '$project',
  '$replaceRoot',
  '$replaceWith',
  '$sample',
  '$set',
  '$skip',
  '$sort',
  '$unset',
  '$unwind',
])

function assertNoForbiddenOperator(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertNoForbiddenOperator(entry, `${path}[${String(index)}]`)
    })

    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_OPERATORS.has(key))
      throw new Error(`Operator ${key} is not allowed in read-only database queries.`)
    assertNoForbiddenOperator(child, `${path}.${key}`)
  }
}

export function assertMongoReadQuery(query: MongoReadQuery): void {
  assertNoForbiddenOperator(query.filter)
  assertNoForbiddenOperator(query.projection)
  assertNoForbiddenOperator(query.sort)
  assertNoForbiddenOperator(query.pipeline)
  if (query.operation === 'aggregate') {
    for (const stage of query.pipeline ?? []) {
      const keys = Object.keys(stage)

      if (keys.length !== 1 || !READ_ONLY_PIPELINE_STAGES.has(keys[0]!)) {
        throw new Error(
          `Aggregation stage ${keys[0] ?? '(empty)'} is not allowed by the read-only gateway.`,
        )
      }
    }
  }
}
