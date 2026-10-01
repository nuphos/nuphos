// Native team memory store (memory-poc-analysis.md §17.3).
// Two collections + a queryable application journal. Team scope is a hard
// filter on every query; secret-bearing content fails closed (§17.7).

export { setupTeamMemoryIndexes } from './store/indexes'
export { createProposal, publishProposal } from './store/proposals'
export {
  countPersonalMemoryRecords,
  countSearchablePlaybooks,
  countTeamMemoryRecords,
  getMemoryRecord,
  getTeamMemory,
  listActivePlaybooks,
  listConversationMemoryTitles,
  listPersonalMemoryIndex,
} from './store/reads'
export { createMemoryRecord } from './store/records'
export {
  recordMemoryFetches,
  recordPlaybookFetch,
  searchMemoryRecords,
  searchTeamPlaybooks,
} from './store/search'
export {
  agentMemories,
  findSecretBearingContent,
  LIVE_RECORD_FILTER,
  MEMORY_RECORDS_COLLECTION,
  memoryRecordAccessFilter,
  memoryTextHash,
  playbookContentHash,
  proposalIdempotencyKey,
  redactSecretBearingContent,
  teamMemories,
  teamMemoryProposals,
} from './store/shared'

export type { MemoryRecordIndexEntry, TeamIndexEntry } from './store/reads'
export type { PlaybookSearchHit } from './store/search'
