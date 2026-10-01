// Structured filter query support for the resource list views.
//
// The search box is a single text input. On top of the original plain
// substring behaviour we now understand `key=value` (or `key:value`) tokens,
// e.g. `status=Running`, `ns=kube-system`. Free-text terms and
// structured filters can be mixed: `status=Running gateway` keeps only running
// rows whose text also contains "gateway".
//
// This is the matching half; each view supplies the per-resource field map
// (what `status` / `ns` / `node` mean for that resource). The Cluster Overview
// deep-links here by pre-filling the box with `status=<phase>` — see
// lib/workloadStatus.ts for the phase labels that must line up.

export type FilterFieldValue =
  string | number | boolean | null | undefined | (string | number | boolean | null | undefined)[]

export type ParsedFilter = {
  /**
   * The free-text remainder (everything that isn't a `key=value` token),
   * lowercased and matched as a single substring — NOT split into words. This
   * preserves the original plain-substring behaviour, so space-containing
   * values like a CronJob schedule (`0 * * * *`) still narrow correctly instead
   * of degenerating into "match any row containing `*`".
   */
  text: string
  /** Structured `key=value` constraints; key and value are lowercased. */
  filters: { key: string; value: string }[]
  isEmpty: boolean
}

export type FilterRecord = {
  /** Free-text searchable strings (name, namespace, raw status, …). */
  text: (string | null | undefined)[]
  /** Structured fields a `key=value` token can target. */
  fields?: Record<string, FilterFieldValue>
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0]

    if ((first === '"' || first === "'") && s.endsWith(first)) {
      return s.slice(1, -1)
    }
  }

  return s
}

// Split on whitespace, but keep quoted spans (including the spaces inside them)
// attached to their token. This lets a value contain spaces — both a bare
// phrase (`"foo bar"`) and a quoted filter value (`ns="foo bar"`) survive as a
// single token instead of being split mid-quote.
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let i = 0
  const n = input.length

  while (i < n) {
    while (i < n && /\s/.test(input[i])) i += 1
    if (i >= n) break
    let tok = ''

    while (i < n && !/\s/.test(input[i])) {
      const ch = input[i]

      if (ch === '"' || ch === "'") {
        tok += ch
        i += 1
        while (i < n && input[i] !== ch) {
          tok += input[i]
          i += 1
        }
        if (i < n) {
          tok += input[i] // closing quote
          i += 1
        }
      } else {
        tok += ch
        i += 1
      }
    }
    tokens.push(tok)
  }

  return tokens
}

export function parseFilterQuery(input: string): ParsedFilter {
  const tokens = tokenize(input)
  const textTokens: string[] = []
  const filters: { key: string; value: string }[] = []

  for (const tok of tokens) {
    // A structured token is `key=value` / `key:value` where the key starts with
    // a letter — so `8:00` or `*/5` stay free text, only `status=Running`-style
    // tokens are treated as filters.
    const m = /^([A-Za-z][\w.-]*)[:=](.*)$/.exec(tok)

    if (m) {
      const value = stripQuotes(m[2])

      // A `key=` token with an empty value is treated as no constraint, so a
      // half-typed token doesn't blank the table.
      if (value !== '') filters.push({ key: m[1].toLowerCase(), value: value.toLowerCase() })
    } else {
      textTokens.push(stripQuotes(tok))
    }
  }
  const text = textTokens.join(' ').toLowerCase()

  return { text, filters, isEmpty: text === '' && filters.length === 0 }
}

export function matchesFilter(parsed: ParsedFilter, record: FilterRecord): boolean {
  if (parsed.isEmpty) return true
  const haystack = record.text
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .join(' ')
    .toLowerCase()

  if (parsed.text && !haystack.includes(parsed.text)) return false
  for (const { key, value } of parsed.filters) {
    const known = record.fields ? key in record.fields : false

    if (!known) {
      // Unknown field for this resource: fall back to treating the value as a
      // free-text term so the query still narrows rather than silently
      // matching every row.
      if (!haystack.includes(value)) return false
      continue
    }
    const raw = record.fields![key]
    const candidates = (Array.isArray(raw) ? raw : [raw])
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v).toLowerCase())

    if (!candidates.some((c) => c === value || c.includes(value))) return false
  }

  return true
}

/**
 * Convenience for views: parse once and return a row predicate. Callers should
 * memoise on `filter` (the parse is cheap but runs per keystroke otherwise).
 */
export function makeFilterMatcher<T>(
  filter: string,
  toRecord: (row: T) => FilterRecord,
): (row: T) => boolean {
  const parsed = parseFilterQuery(filter)

  if (parsed.isEmpty) return () => true

  return (row: T) => matchesFilter(parsed, toRecord(row))
}
