// Resource hints in an HTML file preview. A CSP does not stop a browser
// resolving `<link rel="dns-prefetch" href="//host">` or opening a
// `preconnect`, so a file could still tell a remote host it was opened. These
// `<link>` elements are removed before the markup becomes the frame's srcdoc.
//
// The browser's own parser finds them: DOMParser builds an inert document (no
// script runs, nothing loads) with the same tokenizer the frame will use, in
// linear time whatever the file holds. A file with no hint is passed through
// exactly as written; one with hints is serialized back from that document.

/** Parses HTML into an inert document; injectable so tests can run without a DOM. */
export type HtmlParser = (html: string) => Document

const HINTS = new Set([
  'dns-prefetch',
  'preconnect',
  'prefetch',
  'prerender',
  'preload',
  'modulepreload',
])

const parseInert: HtmlParser = (html) => new DOMParser().parseFromString(html, 'text/html')

/** Whether a `rel` value (space-separated, any case) asks the browser to reach out ahead of time. */
export function isHintRel(rel: string | null): boolean {
  return (rel ?? '')
    .toLowerCase()
    .split(/[\t\n\f\r ]+/)
    .some((token) => HINTS.has(token))
}

/** `html` without its resource-hint `<link>` elements. */
export function stripResourceHints(html: string, parse: HtmlParser = parseInert): string {
  // A tag name is never written with character references: no "link", no link element.
  if (!/link/i.test(html)) return html
  const doc = parse(html)
  const hints = [...doc.querySelectorAll('link')].filter((link) =>
    isHintRel(link.getAttribute('rel')),
  )

  if (hints.length === 0) return html
  for (const link of hints) link.remove()

  return serializeDocument(doc)
}

/** The document as markup, its doctype (and so its rendering mode) kept. */
export function serializeDocument(doc: Pick<Document, 'doctype' | 'documentElement'>): string {
  const type = doc.doctype
  const ids = type
    ? [
        type.publicId && `PUBLIC "${type.publicId}"`,
        type.systemId && `${type.publicId ? '' : 'SYSTEM '}"${type.systemId}"`,
      ].filter(Boolean)
    : []
  const doctype = type ? `<!DOCTYPE ${[type.name, ...ids].join(' ')}>` : ''

  return doctype + doc.documentElement.outerHTML
}
