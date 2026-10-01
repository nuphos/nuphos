import { MongoServerError } from 'mongodb'

import { agentMemories, teamMemories, teamMemoryProposals } from './shared'

import type { Collection } from 'mongodb'

export async function setupTeamMemoryIndexes(): Promise<void> {
  await teamMemories().createIndex({ teamId: 1, status: 1, updatedAt: -1 })
  await teamMemories().createIndex({ teamId: 1, lineageId: 1 })
  await teamMemoryProposals().createIndex({ teamId: 1, idempotencyKey: 1 }, { unique: true })
  await teamMemoryProposals().createIndex({ teamId: 1, userId: 1, status: 1, createdAt: -1 })
  // TTL reaps only PENDING proposals: published ones carry the dedup key and
  // provenance, and the crash-repair republish path needs them to survive.
  // The definition changed after the first prod import — drop a conflicting
  // legacy (non-partial) index before recreating.
  const proposalTtlOptions = {
    expireAfterSeconds: 0,
    partialFilterExpression: { status: 'proposed' },
  }

  try {
    await teamMemoryProposals().createIndex({ expiresAt: 1 }, proposalTtlOptions)
  } catch (err) {
    // 85 IndexOptionsConflict / 86 IndexKeySpecsConflict — which one Mongo
    // reports depends on how the legacy (non-partial) definition differs.
    if (err instanceof MongoServerError && (err.code === 85 || err.code === 86)) {
      try {
        await teamMemoryProposals().dropIndex('expiresAt_1')
      } catch (dropErr) {
        // 27 IndexNotFound: a concurrent replica won the drop race — benign.
        if (!(dropErr instanceof MongoServerError && dropErr.code === 27)) throw dropErr
      }
      await teamMemoryProposals().createIndex({ expiresAt: 1 }, proposalTtlOptions)
    } else {
      throw err
    }
  }
  await agentMemories().createIndex({ ownerUserId: 1, scope: 1, updatedAt: -1 })
  await agentMemories().createIndex({ teamId: 1, scope: 1, updatedAt: -1 })
  await agentMemories().createIndex({ textHash: 1 }, { sparse: true })
  // Backs listConversationMemoryTitles: read once per auto-ingest, on the hot
  // turn-finish path. Sparse — save_memory records carry no conversationId.
  await agentMemories().createIndex({ conversationId: 1, createdAt: -1 }, { sparse: true })
  // Full-text recall (ADR-0008 rung 1★): lets memory_get reach the long tail
  // beyond the top-50 index. Community Mongo has no $vectorSearch; $text
  // keyword recall is the no-vector rung. textSearch/searchText hold the
  // CJK shadow tokens (track A3) — Mongo cannot tokenize Chinese itself.
  // One text index per collection — on definition conflict, drop the old
  // text index (whatever its name) and recreate, same as the TTL index.
  // Weights: authored signals (title/keywords, ADR-0008 track B) outrank the
  // body — LongMemEval's fact-augmented-keys result, applied to $text.
  await ensureTextIndex(
    agentMemories() as unknown as Collection<Record<string, unknown>>,
    { title: 'text', keywords: 'text', text: 'text', textSearch: 'text' },
    {
      weights: { title: 12, keywords: 10, text: 5, textSearch: 3 },
      name: 'memory_text_search',
    },
  )
  // Playbooks join keyword recall (track A2): title/signals/case evidence,
  // plus their CJK shadow tokens.
  await ensureTextIndex(
    teamMemories() as unknown as Collection<Record<string, unknown>>,
    {
      'gene.title': 'text',
      'gene.triggerSignals': 'text',
      'capsules.problem': 'text',
      'capsules.rootCause': 'text',
      searchText: 'text',
    },
    {
      weights: {
        'gene.title': 10,
        'gene.triggerSignals': 8,
        searchText: 6,
        'capsules.problem': 4,
        'capsules.rootCause': 4,
      },
      name: 'gene_text_search',
    },
  )
}

// Create a text index, replacing any existing text index whose definition
// differs (Mongo allows one text index per collection, so a spec change
// always needs a drop first). setupIndexes() runs on EVERY backend boot, so
// concurrent replicas can race through the 85/86 recovery path — each step
// tolerates the other replica having already done it (drop: IndexNotFound;
// recreate: conflict re-checked against the target name).
async function ensureTextIndex(
  collection: Collection<Record<string, unknown>>,
  spec: Record<string, 'text'>,
  options: { weights: Record<string, number>; name: string },
): Promise<void> {
  try {
    await collection.createIndex(spec, options)

    return
  } catch (err) {
    if (!(err instanceof MongoServerError && (err.code === 85 || err.code === 86))) throw err
  }
  const indexes = (await collection.listIndexes().toArray()) as {
    name: string
    key: Record<string, unknown>
  }[]

  for (const index of indexes) {
    if (index.key._fts !== 'text') continue
    try {
      await collection.dropIndex(index.name)
    } catch (err) {
      // 27 IndexNotFound: another replica already dropped it — fine.
      if (!(err instanceof MongoServerError && err.code === 27)) throw err
    }
  }
  try {
    await collection.createIndex(spec, options)
  } catch (err) {
    if (err instanceof MongoServerError && (err.code === 85 || err.code === 86)) {
      // Another replica recreated first. If the surviving text index carries
      // our target name, the swap converged — anything else is a real error.
      const winner = (await collection.listIndexes().toArray()) as { name: string }[]

      if (winner.some((i) => i.name === options.name)) return
    }
    throw err
  }
}
