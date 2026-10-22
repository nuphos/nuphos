// Codex's bundled skills ask the model for directives that only the Codex app
// renders, so they would otherwise show as raw text in a Codex agent's reply:
//
//   :codex-file-citation{path="…" purpose="output" label="…"}  (Drive, documents, PDF, …)
//   :codex-followup[Label]{prompt="…"}
//   ::code-comment{title="…" body="…" file="…" start=10 end=12}  (codex-security)
//
// They become the Markdown the Codex app's rendering corresponds to. The stored
// message keeps the original text; directives in code, or after `\`, stay as written.

type Attributes = Map<string, string>

const NAME = /[\w-]/

/** Reads `{name="value" name='value' name=bare}` at `start` (the `{`); null unless well formed. */
function readAttributes(
  text: string,
  start: number,
): { attributes: Attributes; end: number } | null {
  const attributes: Attributes = new Map()
  let i = start + 1

  for (;;) {
    while (/\s/.test(text[i] ?? '')) i++
    if (text[i] === '}') return { attributes, end: i + 1 }
    const nameStart = i

    while (NAME.test(text[i] ?? '')) i++
    if (i === nameStart || text[i] !== '=') return null
    const name = text.slice(nameStart, i)
    const quote = text[++i]
    let value = ''

    if (quote === '"' || quote === "'") {
      for (i++; i < text.length && text[i] !== quote; i++) {
        if (text[i] === '\\' && text[i + 1] === quote) i++
        value += text[i]
      }
      if (i >= text.length) return null
      i++
    } else {
      const valueStart = i

      while (i < text.length && !/[\s}]/.test(text[i] ?? '')) i++
      value = text.slice(valueStart, i)
    }
    attributes.set(name, value.trim())
  }
}

const escapeLabel = (label: string) => label.replace(/[\\[\]]/g, '\\$&')

function citation(attributes: Attributes): string | null {
  const path = attributes.get('path')

  if (!path) return null
  // The Codex app shows `label`, then `title`, then the URL; a local file shows its name.
  const name =
    attributes.get('label') ||
    attributes.get('title') ||
    (/^[a-z][\w+.-]*:\/\//i.test(path) ? path : (path.split('/').findLast(Boolean) ?? path))
  const target = /[\s()<>]/.test(path) ? `<${path.replace(/[<>]/g, encodeURIComponent)}>` : path

  return `[${escapeLabel(name)}](${target})`
}

// The Codex TUI's fallback for a review comment.
function codeComment(attributes: Attributes): string | null {
  const title = attributes.get('title')
  const body = attributes.get('body')

  if (!title || !body) return null
  const file = attributes.get('file')
  const [start, end] = [attributes.get('start'), attributes.get('end')]
  const lines = start && end && end !== start ? `${start}-${end}` : start
  const where = file && lines ? `${file}:${lines}` : file
  const location = where ? ` — ${where}` : ''

  return `- ${title}${location}\n\n  ${body.replace(/\n/g, '\n  ')}`
}

/** Directive at `i` (its first `:`), as replacement Markdown and the index after it. */
function directiveAt(text: string, i: number, lineStart: boolean) {
  if (text.startsWith(':codex-file-citation{', i)) {
    const read = readAttributes(text, i + ':codex-file-citation'.length)
    const markdown = read && citation(read.attributes)

    return read && markdown ? { markdown, end: read.end } : null
  }
  if (text.startsWith(':codex-followup[', i)) {
    const close = text.indexOf(']', i)
    const label = close < 0 ? '' : text.slice(i + ':codex-followup['.length, close)

    if (!label.trim() || label.includes('\n') || text[close + 1] !== '{') return null
    const read = readAttributes(text, close + 1)

    return read && { markdown: label, end: read.end }
  }
  if (lineStart && text.startsWith('::code-comment{', i)) {
    const read = readAttributes(text, i + '::code-comment'.length)
    const markdown = read && codeComment(read.attributes)

    return read && markdown ? { markdown, end: read.end } : null
  }

  return null
}

/** Rewrites Codex app directives outside code into plain Markdown. */
export function renderCodexDirectives(markdown: string): string {
  if (!markdown.includes(':codex-') && !markdown.includes('::code-comment{')) return markdown
  let output = ''
  let fence = ''
  let inline = 0
  // Leading spaces on the current line, or -1 once other text appeared.
  let column = 0
  let previous = ''
  let i = 0

  while (i < markdown.length) {
    const char = markdown[i] ?? ''
    let next = i + 1

    if (fence) {
      if (char === fence[0] && column >= 0) {
        next = markdown.indexOf('\n', i)
        if (next < 0) next = markdown.length
        const line = markdown.slice(i, next)
        let run = 0

        while (line[run] === char) run++
        if (run >= fence.length && !line.slice(run).trim()) fence = ''
      }
    } else if ((char === '`' || char === '~') && previous !== '\\') {
      while (markdown[next] === char) next++
      const run = markdown.slice(i, next)

      if (column >= 0 && !inline && run.length >= 3) fence = run
      else if (char === '`') inline = inline === run.length ? 0 : inline || run.length
    } else if (char === ':' && !inline && previous !== '\\' && previous !== ':') {
      const directive = directiveAt(markdown, i, column >= 0)

      if (directive) {
        output += directive.markdown
        column = -1
        previous = ')'
        i = directive.end
        continue
      }
    }
    const text = markdown.slice(i, next)

    output += text
    for (const c of text) {
      // A blank line ends a paragraph, and with it any unclosed code span.
      if (c === '\n' && previous === '\n') inline = 0
      if (c === '\n') column = 0
      else column = c === ' ' && column >= 0 && column < 3 ? column + 1 : -1
      previous = c === '\\' && previous === '\\' ? '' : c
    }
    i = next
  }

  return output
}
