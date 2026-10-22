// Codex's bundled skills (Google Drive, documents, PDF, spreadsheets,
// presentations) tell the model to cite files as `:codex-file-citation{...}`,
// a directive only the Codex app renders. Nuphos streams it as a Markdown link.
const START = ':codex-file-citation{'
// Longer than any real citation or fence line; anything longer is released as written.
const MAX_HELD = 4096
const CITATION = /^:codex-file-citation\{([^{}]*)\}$/
const ATTRIBUTE = /(?:^|\s)([\w-]+)="([^"\n]*)"/g

function markdownLink(path: string, title?: string): string {
  const name =
    title ??
    (/^[a-z][\w+.-]*:\/\//i.test(path) ? path : (path.split('/').findLast(Boolean) ?? path))
  const label = name.replace(/[\\[\]]/g, '\\$&')
  const target = /[\s()<>]/.test(path) ? `<${path.replace(/[<>]/g, encodeURIComponent)}>` : path

  return `[${label}](${target})`
}

function citationLink(directive: string): string | null {
  const attributes = CITATION.exec(directive)?.[1]

  if (attributes === undefined || attributes.replace(ATTRIBUTE, '').trim()) return null
  const values = new Map(
    [...attributes.matchAll(ATTRIBUTE)].map(([, name, value]) => [name, value?.trim()]),
  )
  const path = values.get('path')

  // The Codex app shows `label`, then `title`, in place of the path.
  return path ? markdownLink(path, values.get('label') || values.get('title') || undefined) : null
}

/**
 * One Markdown message's stream. Each call returns what can be shown now; a
 * possible citation, backtick run, or fence line stays held until it resolves
 * or `final` is set. Citations inside code spans, code fences, after `\`, or
 * after another `:` stay as written.
 */
export function codexFileCitationScanner() {
  let tail = ''
  let fence = ''
  let inline = 0
  // Leading spaces on the current line, or -1 once other text appeared.
  let column = 0
  let slashes = 0
  let previous = ''

  return (chunk: string, final = false): string => {
    const input = tail + chunk
    let output = ''
    let i = 0
    const emit = (text: string) => {
      output += text
      for (const char of text) {
        // A blank line ends a paragraph, and with it any unclosed code span.
        if (char === '\n' && previous === '\n') inline = 0
        if (char === '\n') column = 0
        else column = char === ' ' && column >= 0 && column < 3 ? column + 1 : -1
        slashes = char === '\\' ? slashes + 1 : 0
        previous = char
      }
    }
    const waits = (from: number) => !final && input.length - from < MAX_HELD

    while (i < input.length) {
      const char = input[i] ?? ''

      if (fence) {
        let end = i + 1

        if (char === fence[0] && column >= 0) {
          end = input.indexOf('\n', i)
          if (end < 0 && waits(i)) break
          if (end < 0) end = input.length
          const line = input.slice(i, end)
          let run = 0

          while (line[run] === char) run++
          if (run >= fence.length && !line.slice(run).trim()) fence = ''
        }
        emit(input.slice(i, end))
        i = end
        continue
      }
      if ((char === '`' || char === '~') && !(slashes % 2)) {
        let end = i + 1

        while (input[end] === char) end++
        if (end === input.length && waits(i)) break
        const run = input.slice(i, end)

        if (column >= 0 && !inline && run.length >= 3) fence = run
        else if (char === '`') inline = inline === run.length ? 0 : inline || run.length
        emit(run)
        i = end
        continue
      }
      if (char === ':' && !inline && !(slashes % 2) && previous !== ':') {
        if (input.startsWith(START, i)) {
          const close = input.indexOf('}', i)

          if (close < 0 && waits(i)) break
          const link = close < 0 ? null : citationLink(input.slice(i, close + 1))

          if (link) {
            emit(link)
            i = close + 1
            continue
          }
        } else if (!final && START.startsWith(input.slice(i))) break
      }
      emit(char)
      i++
    }
    tail = input.slice(i)

    return output
  }
}
