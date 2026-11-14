// GFM's autolink-literal rule (remark-gfm, on by default in Streamdown) turns
// any bare `www.…`, bare domain or e-mail address in prose into a link, adding
// a scheme the author never wrote. In agent chat those bare literals are
// usually *data* — a CNAME target, a record value, an account owner's address —
// so the result is a link nobody asked for, pointing at a customer's domain.
//
// The tell is the scheme GFM synthesizes: `http://` for a bare host, `mailto:`
// for a bare address. Anything the author scheme'd themselves (`https://…`) or
// wrote as an explicit `[label](url)` keeps its link. Comparing href to link
// text does NOT work here — by the time it reaches the renderer the href has
// been normalized (IDN punycode, percent-escapes, trailing slash) and no longer
// matches the text it came from.

const EXPLICIT_SCHEME = /^(https?:\/\/|mailto:)/i

/** True when the href's scheme was synthesized by GFM rather than written by the author. */
export function isSynthesizedAutolink(href: string, text: string): boolean {
  const literal = text.trim()

  if (!literal || EXPLICIT_SCHEME.test(literal)) return false
  // A bare address is the only thing GFM turns into `mailto:`; an explicit
  // [寄信](mailto:…) has a label that looks nothing like one.
  if (href.startsWith('mailto:')) return /^[^\s@]+@[^\s@]+$/.test(literal)

  // GFM only ever synthesizes plain `http://`. An https href with a scheme-less
  // label is an explicit link and stays one.
  return href.startsWith('http://')
}

// GFM ends a bare URL only at ASCII whitespace, so the full-width punctuation
// right after it in CJK prose — `…/pull/2595（Fixes #2594）` — and the word
// after that become part of the link. A bare URL ends at its first non-ASCII
// punctuation or space instead; CJK letters in a path still belong to it.
const BARE_URL_BREAK = /(?!\p{ASCII})[\p{P}\p{Z}]/u

type Node = { type: string; value?: string; url?: string; children?: Node[] }

function endBareUrls(parent: Node): void {
  const children = parent.children ?? []

  for (const [i, node] of children.entries()) {
    const [only, ...more] = node.children ?? []

    // A link whose text is its own URL (GFM adds `http://` before a bare `www.`).
    if (node.type !== 'link' || only?.type !== 'text' || more.length > 0) {
      endBareUrls(node)
      continue
    }
    const literal = only.value ?? ''
    const end = literal.search(BARE_URL_BREAK)

    if (end > 0 && node.url?.endsWith(literal)) {
      const rest = literal.slice(end)

      node.url = node.url.slice(0, -rest.length)
      only.value = literal.slice(0, end)
      children.splice(i + 1, 0, { type: 'text', value: rest })
    }
  }
}

/** Remark plugin: ends each bare URL at its first non-ASCII punctuation or space. */
export function remarkEndBareUrls() {
  return endBareUrls
}
