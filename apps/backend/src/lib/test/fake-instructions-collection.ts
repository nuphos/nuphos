import type { AgentInstruction } from '@/models'
import type { ObjectId } from 'mongodb'

type Filter = Partial<Record<keyof AgentInstruction, unknown>>

function sameValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && 'equals' in expected) {
    return (expected as ObjectId).equals(actual as ObjectId)
  }

  return actual === expected
}

function matches(doc: AgentInstruction, filter: Filter): boolean {
  return Object.entries(filter).every(([key, value]) =>
    sameValue(doc[key as keyof AgentInstruction], value),
  )
}

/** In-memory stand-in for the `agent_instructions` collection. */
export function createFakeInstructionsCollection() {
  const docs: AgentInstruction[] = []

  const collection = {
    docs,
    find: (filter: Filter) => ({
      sort: () => ({
        toArray: async () =>
          docs
            .filter((doc) => matches(doc, filter))
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map((doc) => ({ ...doc })),
      }),
    }),
    findOne: async (filter: Filter) => {
      const found = docs.find((doc) => matches(doc, filter))

      return found ? { ...found } : null
    },
    insertOne: async (doc: AgentInstruction) => {
      docs.push({ ...doc })

      return { acknowledged: true, insertedId: doc._id }
    },
    findOneAndUpdate: async (filter: Filter, update: { $set: Partial<AgentInstruction> }) => {
      const found = docs.find((doc) => matches(doc, filter))

      if (!found) return null
      Object.assign(found, update.$set)

      return { ...found }
    },
    deleteOne: async (filter: Filter) => {
      const index = docs.findIndex((doc) => matches(doc, filter))

      if (index >= 0) docs.splice(index, 1)

      return { acknowledged: true, deletedCount: index >= 0 ? 1 : 0 }
    },
    reset: () => {
      docs.length = 0
    },
  }

  return collection
}
