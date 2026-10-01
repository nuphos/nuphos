export * from './types'
export { canonicalize, JournalCanonicalizeError } from './canonical'
export { toStorableJson } from './normalize'
export {
  sha256Hex,
  computePayloadHash,
  computeEntryHash,
  hmacSha256Hex,
  digestEquals,
} from './hashing'
export { redactSecrets, shannonEntropy, type RedactionResult, type RedactionMatch } from './redact'
export {
  deriveEventId,
  buildAuditEvent,
  JournalEventIdError,
  type EventIdParts,
  type BuildEventInput,
} from './event'
export {
  JournalWriter,
  JournalAppendError,
  ensureJournalIndexes,
  JOURNAL_COLLECTION,
  type JournalDoc,
  type JournalAppendInput,
  type JournalAppendResult,
} from './append'
export { verifyConversationChain, type ChainVerification, type ChainViolation } from './verify'
