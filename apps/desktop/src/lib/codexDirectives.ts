// Codex's bundled skills ask the model for directives that only the Codex app
// renders, so they would otherwise show as raw text in a Codex agent's reply:
//
//   :codex-file-citation{path="…" purpose="output" label="…"}  (Drive, documents, PDF, …)
//   :codex-followup[Label]{prompt="…"}
//   ::code-comment{title="…" body="…" file="…" start=10 end=12}  (codex-security)
//
// A remark plugin turns them into what the Codex app's rendering corresponds
// to. It only reads prose text nodes, so code and inline code stay as written,
// and the stored message keeps the original text.

type Node = {
  type: string
  value?: string
  url?: string
  children?: Node[]
  position?: { start: { offset?: number }; end: { offset?: number } }
}

type Attributes = Map<string, string>

const NAME = /[\w-]/

/** Reads `{name="value" name='value' name=bare}` at `start` (the `{`); null unless well formed. */
function readAttributes(
  source: string,
  start: number,
): { attributes: Attributes; end: number } | null {
  const attributes: Attributes = new Map()
  let i = start + 1

  for (;;) {
    while (/\s/.test(source[i] ?? '')) i++
    if (source[i] === '}') return { attributes, end: i + 1 }
    const nameStart = i

    while (NAME.test(source[i] ?? '')) i++
    if (i === nameStart || source[i] !== '=') return null
    const name = source.slice(nameStart, i)
    const quote = source[++i]
    let value = ''

    if (quote === '"' || quote === "'") {
      for (i++; i < source.length && source[i] !== quote; i++) {
        if (source[i] === '\\' && source[i + 1] === quote) i++
        value += source[i]
      }
      if (i >= source.length) return null
      i++
    } else {
      const valueStart = i

      while (i < source.length && !/[\s}]/.test(source[i] ?? '')) i++
      value = source.slice(valueStart, i)
    }
    attributes.set(name, value.trim())
  }
}

const text = (value: string): Node => ({ type: 'text', value })

function citation(attributes: Attributes): Node[] | null {
  const path = attributes.get('path')

  if (!path) return null
  // The Codex app shows `label`, then `title`, then the URL; a local file shows its name.
  const name =
    attributes.get('label') ||
    attributes.get('title') ||
    (/^[a-z][\w+.-]*:\/\//i.test(path) ? path : (path.split('/').findLast(Boolean) ?? path))

  return [{ type: 'link', url: path, children: [text(name)] }]
}

// The Codex TUI's fallback for a review comment: title, location, then the body.
function codeComment(attributes: Attributes): Node[] | null {
  const title = attributes.get('title')
  const body = attributes.get('body')

  if (!title || !body) return null
  const file = attributes.get('file')
  const [start, end] = [attributes.get('start'), attributes.get('end')]
  const lines = start && end && end !== start ? `${start}-${end}` : start
  const where = file && lines ? `${file}:${lines}` : file

  return [
    { type: 'strong', children: [text(title)] },
    ...(where ? [text(` — ${where}`)] : []),
    { type: 'break' },
    text(body),
  ]
}

const startsLine = (source: string, at: number) =>
  /^[ \t]*$/.test(source.slice(source.lastIndexOf('\n', at - 1) + 1, at))

/** The directive starting at `at` in the source, as nodes and the offset after it. */
function directiveAt(source: string, at: number): { nodes: Node[]; end: number } | null {
  let read: ReturnType<typeof readAttributes> = null
  let nodes: Node[] | null = null

  if (source.startsWith(':codex-file-citation{', at)) {
    read = readAttributes(source, at + ':codex-file-citation'.length)
    nodes = read && citation(read.attributes)
  } else if (source.startsWith(':codex-followup[', at)) {
    const close = source.indexOf(']', at)
    const label = source.slice(at + ':codex-followup['.length, close)

    if (close > 0 && label.trim() && !label.includes('\n') && source[close + 1] === '{') {
      read = readAttributes(source, close + 1)
      nodes = [text(label)]
    }
  } else if (source.startsWith('::code-comment{', at) && startsLine(source, at)) {
    read = readAttributes(source, at + '::code-comment'.length)
    nodes = read && codeComment(read.attributes)
  }

  return read && nodes ? { nodes, end: read.end } : null
}

// GFM turns a citation's URL path into a link, so a directive can span these.
const PROSE = new Set(['text', 'link', 'break'])

/** Replaces the first directive found in `children[i]`, a text node. */
function replaceIn(children: Node[], i: number, source: string) {
  const node = children[i]
  const start = node?.position?.start.offset
  const value = node?.value ?? ''

  if (node?.type !== 'text' || start === undefined) return
  for (let k = value.indexOf(':'); k >= 0; k = value.indexOf(':', k + 1)) {
    // Offsets hold only while the text matches its source (no escapes or entities before it).
    if (value.slice(0, k) !== source.slice(start, start + k)) return
    const at = start + k
    const directive = source[at - 1] === ':' ? null : directiveAt(source, at)

    if (!directive) continue
    let j = i

    while ((children[j]?.position?.end.offset ?? Infinity) < directive.end) j++
    const last = children[j]
    const lastEnd = last?.position?.end.offset ?? -1
    const rest = source.slice(directive.end, lastEnd)

    if (
      !children.slice(i, j + 1).every((child) => PROSE.has(child.type)) ||
      (last?.type === 'text' ? !(last.value ?? '').endsWith(rest) : rest !== '')
    )
      continue
    const tail = { start: { offset: directive.end }, end: { offset: lastEnd } }

    children.splice(
      i,
      j - i + 1,
      ...(k ? [text(value.slice(0, k))] : []),
      ...directive.nodes,
      ...(rest ? [{ ...text(rest), position: tail }] : []),
    )

    return
  }
}

function visit(node: Node, source: string) {
  // Code is its own node type; an explicit link keeps its label as written.
  if (!node.children || node.type === 'link' || node.type === 'linkReference') return
  // Text after a replaced directive is a new node later in the list, scanned in turn.
  for (let i = 0; i < node.children.length; i++) {
    replaceIn(node.children, i, source)
    visit(node.children[i] as Node, source)
  }
}

/** Remark plugin: Codex app directives in prose become plain Markdown nodes. */
export function remarkCodexDirectives() {
  return (tree: Node, file: { value: unknown }) => {
    const source = String(file.value)

    if (source.includes(':codex-') || source.includes('::code-comment{')) visit(tree, source)
  }
}
