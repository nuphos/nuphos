// Codex's bundled skills (Google Drive, documents, PDF, spreadsheets,
// presentations) tell the model to cite files as `:codex-file-citation{...}`,
// a directive only the Codex app renders. Nuphos stores it as a Markdown link.
const START = ':codex-file-citation{'
// Longer than any real citation; an unclosed directive is released after this.
const MAX_LENGTH = 4096
const CITATION = /(?<![:\\`]):codex-file-citation\{([^{}]*)\}/g
const ATTRIBUTE = /(?:^|\s)([\w-]+)="([^"\n]*)"/g

function markdownLink(path: string): string {
  const name = /^[a-z][\w+.-]*:\/\//i.test(path)
    ? path
    : (path.split('/').findLast(Boolean) ?? path)
  const label = name.replace(/[\\[\]]/g, '\\$&')
  const target = /[\s()<>]/.test(path) ? `<${path.replace(/[<>]/g, encodeURIComponent)}>` : path

  return `[${label}](${target})`
}

/** Rewrites every complete file citation into a Markdown link to its path. */
export function rewriteCodexFileCitations(text: string): string {
  if (!text.includes(START)) return text

  return text.replace(CITATION, (match, attributes: string) => {
    const pairs = [...attributes.matchAll(ATTRIBUTE)]
    const path = pairs.find(([, name]) => name === 'path')?.[2]?.trim()
    const wellFormed = !attributes.replace(ATTRIBUTE, '').trim()

    return wellFormed && path ? markdownLink(path) : match
  })
}

/** Where an unfinished file citation may begin at the end of `text`; text.length when none. */
export function pendingCodexFileCitationStart(text: string): number {
  for (
    let at = text.lastIndexOf(':');
    at >= 0 && text.length - at <= MAX_LENGTH;
    at = text.lastIndexOf(':', at - 1)
  ) {
    const tail = text.slice(at)

    if (START.startsWith(tail) || (tail.startsWith(START) && !tail.includes('}'))) return at
  }

  return text.length
}
