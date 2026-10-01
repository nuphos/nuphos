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
