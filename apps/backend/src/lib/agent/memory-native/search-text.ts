// CJK-aware shadow tokens for Mongo $text (ADR-0008 track A3).
//
// Mongo's $text tokenizes on whitespace/punctuation only, so an unsegmented
// Chinese clause is ONE giant token and Chinese keyword queries match nothing.
// Fix: at write time, store the dictionary-segmented CJK words in a separate
// search-only field that joins the collection's text index; at query time,
// expand the query the same way. English content needs neither — the shadow
// field holds CJK tokens ONLY, so English scoring is unaffected.
//
// Segmentation uses the built-in Intl.Segmenter (ICU dictionary). If the
// runtime lacks it, we fall back to character bigrams — the same degenerate
// scheme Lucene's CJKAnalyzer uses.

export const CJK_RUN = /[぀-ヿ㐀-䶿一-鿿豈-﫿]+/g

const segmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter('zh', { granularity: 'word' })
    : null

function bigrams(run: string): string[] {
  if (run.length <= 2) return [run]
  const out: string[] = []

  for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2))

  return out
}

// Dictionary-segmented words for every CJK run in `text`, deduped, original
// order. Returns [] when the text contains no CJK.
export function segmentCjk(text: string): string[] {
  const runs = text.match(CJK_RUN)

  if (!runs) return []
  const seen = new Set<string>()

  for (const run of runs) {
    if (segmenter) {
      for (const part of segmenter.segment(run)) {
        const word = part.segment.trim()

        if (word) seen.add(word)
      }
    } else {
      for (const gram of bigrams(run)) seen.add(gram)
    }
  }

  return [...seen]
}

// Shadow-field value for a document: CJK tokens of all parts, space-joined.
// Empty string when nothing is CJK — callers store the field only when
// non-empty so English-only documents stay untouched.
export function buildCjkSearchText(parts: (string | null | undefined)[]): string {
  const seen = new Set<string>()

  for (const part of parts) {
    if (!part) continue
    for (const token of segmentCjk(part)) seen.add(token)
  }

  return [...seen].join(' ')
}

// Cross-variant + bilingual expansion tables (ported from zeabur-rag
// src/bm25.ts). Query-side ONLY: the pool is a simplified/traditional/English
// mix indexed as written, so instead of normalizing either side (which would
// need a content backfill) we append counterpart forms to the QUERY and let
// $text's OR semantics match whichever form the record used. Substring match,
// both directions.
//
// Scope discipline — this stays a SHORT list, not a dictionary. Variant
// pairs are a finite script mapping (completing them is fine). The
// bilingual list admits only (a) high-frequency infra terms and (b) Zeabur
// region names; do NOT chase proper nouns — the cross-lingual long tail is
// covered by the model's own bilingual self-search (memory_get(query) has
// no score floor, so even weak bridges help there) and, if data ever
// justifies it, ADR-0008 rung-4 embeddings.
//
// Update loop: rows are added from OBSERVED misses, not speculation —
// `memory.searched` events already persist the (redacted) query + hitCount, so
// zh queries that return nothing are queryable; a miss earns a row only if it
// passes the scope rule above, and lands with a test beside the existing ones
// (the 台北↔Taipei row is the template: live miss).
const ZH_VARIANT_PAIRS: [simplified: string, traditional: string][] = [
  ['环境变量', '環境變數'],
  ['数据库', '資料庫'],
  ['服务器', '伺服器'],
  ['虚拟机', '虛擬機'],
  ['内存', '記憶體'],
  ['域名', '網域'],
  ['变量', '變數'],
  ['凭证', '憑證'],
  ['连接', '連線'],
  ['设置', '設定'],
  ['计费', '計費'],
  ['项目', '專案'],
  ['服务', '服務'],
  ['数据', '資料'],
  ['集群', '叢集'],
  ['节点', '節點'],
  ['网络', '網路'],
  ['删除', '刪除'],
  ['离线', '離線'],
]

const BILINGUAL_TERM_PAIRS: [english: string, chinese: string][] = [
  ['database', '資料庫'],
  ['backup', '備份'],
  ['deploy', '部署'],
  ['server', '伺服器'],
  ['template', '模板'],
  ['billing', '計費'],
  ['refund', '退款'],
  ['cluster', '叢集'],
  ['node', '節點'],
  ['offline', '離線'],
  ['virtual machine', '虛擬機'],
  ['vm', '虛擬機'],
  ['delete', '刪除'],
  ['credential', '憑證'],
  ['taipei', '台北'],
  ['tokyo', '東京'],
  // 'apple' not 'mac': lower.includes('mac') would false-fire on "machine".
  ['apple', '蘋果'],
]

// $text has an operator syntax, and callers pass PROSE: a double-quoted span
// is a required phrase ANDed onto the whole query, and a token-leading `-` is
// negation. One `"Authorization: Bearer …"` in a pasted snippet and recall
// legally matches nothing. User text is data, never query syntax — and since
// $text has no parameterized form, stripping IS the boundary.
export function neutralizeTextOperators(query: string): string {
  return (
    query
      .replaceAll('"', ' ')
      // A hyphen leading a token negates it; inside a token (server-*,
      // clean-free-cronjob) it is part of the word and must survive.
      .replace(/(^|\s)-+/g, '$1')
  )
}

// Query-side twin of buildCjkSearchText: the raw query, plus counterpart
// script/language forms of any recognized terms, plus CJK tokens of it all —
// so a Chinese keyword matches the shadow field, a simplified query matches
// traditional content (and vice versa), and a zh query reaches en records.
// Queries with no CJK and no recognized terms pass through unchanged.
export function expandSearchQuery(rawQuery: string): string {
  const query = neutralizeTextOperators(rawQuery)
  const extra = new Set<string>()

  for (const [simp, trad] of ZH_VARIANT_PAIRS) {
    if (query.includes(simp)) extra.add(trad)
    if (query.includes(trad)) extra.add(simp)
  }
  const lower = query.toLowerCase()
  const zhScope = `${query} ${[...extra].join(' ')}`

  for (const [en, zh] of BILINGUAL_TERM_PAIRS) {
    if (lower.includes(en)) extra.add(zh)
    if (zhScope.includes(zh)) extra.add(en)
  }
  const expanded = extra.size ? `${query} ${[...extra].join(' ')}` : query
  const tokens = segmentCjk(expanded)

  if (tokens.length === 0 && extra.size === 0) return query

  return tokens.length ? `${expanded} ${tokens.join(' ')}` : expanded
}
