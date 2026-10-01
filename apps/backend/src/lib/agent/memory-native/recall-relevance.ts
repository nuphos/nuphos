import { CJK_RUN, expandSearchQuery, segmentCjk } from './search-text'

// Mongo's English $text stop words that survive into prose queries, plus the
// politeness filler users type.
const STOP_WORDS = new Set(
  (
    'a an and are as at be but by can could did do does for from had has have how i if in into ' +
    'is it its me my no not of on or our please should so than that the their them then there ' +
    'these they this to us was we were what when where which who why will with would you your'
  ).split(' '),
)

const PREFIX_CHARS = 5

function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 4 && /(s|x|z|ch|sh)es$/.test(token)) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)

  return token
}

/** Distinct search terms: stemmed Latin words (no stop words) plus segmented CJK words. */
export function recallTerms(text: string): Set<string> {
  const terms = new Set<string>()

  for (const raw of text
    .toLowerCase()
    .replace(CJK_RUN, ' ')
    .split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOP_WORDS.has(raw)) continue
    terms.add(stem(raw))
  }
  for (const word of segmentCjk(text)) {
    if (word.length >= 2) terms.add(word)
  }

  return terms
}

/**
 * $text scores are a weighted sum, so one common word in a heavily weighted
 * title clears the score floor on its own. A pointer is attached only when it
 * shares at least two distinct query terms (one, for a one-term query). Terms
 * sharing a five-character prefix count as the same word, which covers the
 * stemming differences between this and Mongo's analyzer.
 */
export function sharesEnoughQueryTerms(query: string, fields: (string | undefined)[]): boolean {
  const queryTerms = recallTerms(expandSearchQuery(query))

  if (queryTerms.size === 0) return true
  const fieldTerms = recallTerms(fields.filter(Boolean).join(' '))
  const prefixes = new Set(
    [...fieldTerms].filter((t) => t.length >= PREFIX_CHARS).map((t) => t.slice(0, PREFIX_CHARS)),
  )
  const required = Math.min(2, queryTerms.size)
  let shared = 0

  for (const term of queryTerms) {
    const hit =
      fieldTerms.has(term) ||
      (term.length >= PREFIX_CHARS && prefixes.has(term.slice(0, PREFIX_CHARS)))

    if (hit && ++shared >= required) return true
  }

  return false
}
