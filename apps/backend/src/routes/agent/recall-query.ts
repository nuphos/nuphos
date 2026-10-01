// The recall SEARCH query is not the user's message. A thin follow-up ("繼續",
// "再深入一點", "why?") has almost no keywords, so lexical $text recall finds
// nothing for it. Enrich only thin turns with the nearest substantive earlier
// user message; substantive queries pass through. Kept separate from the raw
// memoryQuery the judge/digest use — they must see what the user actually said.
// ponytail: deterministic keyword borrow, no LLM on the hot recall path; the
// upgrade path is an LLM query rewrite (one small-model call, gated + budgeted).

// Under this trimmed length a message can't stand as a search query on its own
// (CJK deixis, English stubs). Heuristic — a wrong call only changes which
// memories are searched, never errors a turn.
const THIN_QUERY_CHARS = 12
// Cap the borrowed context so one long earlier turn can't dominate the query.
const BORROWED_CONTEXT_CHARS = 240
// Ceiling for the final query. Structured noise is stripped below, so what is
// left is prose; past this much of it, extra terms add match risk, not intent.
const QUERY_CHARS = 800
// Bounded flattening passes for nested payloads (depth, not size).
const MAX_BRACE_PASSES = 20

/** Strip machine-structured spans a turn embeds — fenced code, JSON payloads
 * — keeping the prose around them.
 *
 * Thin queries were the visible half of the problem; FAT ones fail worse. A
 * webhook turn is one sentence of intent ("A Better Stack incident event was
 * received for the monid project") wrapped around 4KB of payload, and the
 * payload's tokens (header names, ids, field names) out-score the sentence:
 * measured on prod, the raw turn recalled kubeconfig/DNS/IAM memories — every
 * one a payload-token collision — and ranked the actual monitoring memories
 * out of the five slots. The payload is DATA the turn carries, not what the
 * turn is about.
 *
 * Inline code keeps its content (backticks dropped): identifiers like
 * `server-*` or `clean-free-cronjob` are exactly the searchable names. */
export function stripStructuredNoise(text: string): string {
  let out = text.replace(/```[\s\S]*?```/g, ' ')

  // Innermost-first brace removal, bounded by nesting depth: each pass
  // deletes {…} spans with no inner braces, so nested JSON collapses without
  // a parser and CJK prose outside braces is never touched.
  for (let i = 0; i < MAX_BRACE_PASSES && /\{[^{}]*\}/.test(out); i++) {
    out = out.replace(/\{[^{}]*\}/g, ' ')
  }

  return out.replaceAll('`', ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Build the recall search query from user message texts, ordered newest-first
 * (as `getUserMessageTexts` returns them). Returns the latest message unchanged
 * unless it is too thin to search on, in which case it is prefixed with the
 * most recent substantive earlier user message so the follow-up inherits its
 * keywords.
 */
export function composeRecallQuery(userTextsNewestFirst: string[]): string {
  const latest = stripStructuredNoise(userTextsNewestFirst[0] ?? '')

  if (latest.length >= THIN_QUERY_CHARS) return latest.slice(0, QUERY_CHARS)

  const prior = userTextsNewestFirst
    .slice(1)
    .map((t) => stripStructuredNoise(t))
    .find((t) => t.length >= THIN_QUERY_CHARS)

  if (!prior) return latest

  return `${prior.slice(0, BORROWED_CONTEXT_CHARS)} ${latest}`.trim()
}
