import { api } from '../../../api'
import { isAtlasUrl, renderMentionChip } from '../../../lib/atlasLinkMention'

// ------------------------------------------------------------------------
// Serialization: walk the editor's DOM and produce plain text. Mention
// chips serialize back to their underlying URL so the agent always receives
// the canonical link, not the human-friendly label.
// ------------------------------------------------------------------------
export function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeName === 'BR') return '\n'
  if (node instanceof HTMLElement) {
    if (node.dataset.atlasUrl) return node.dataset.atlasUrl
    if (node.nodeName === 'DIV' || node.nodeName === 'P') {
      // Browsers wrap soft-broken lines in <div>/<p> on contenteditable.
      // Treat them as line breaks.
      const inner = Array.from(node.childNodes).map(serializeNode).join('')

      return `\n${inner}`
    }

    return Array.from(node.childNodes).map(serializeNode).join('')
  }

  return ''
}

export function readEditorText(el: HTMLDivElement | null): string {
  if (!el) return ''

  return serializeNode(el).replace(/^\n+/, '')
}

/** Rebuild the editor from serialized text, turning Nuphos links back into chips. */
export function restoreEditorText(el: HTMLDivElement, text: string) {
  const nodes: Node[] = []

  text.split('\n').forEach((line, index) => {
    if (index > 0) nodes.push(document.createElement('br'))
    for (const part of line.split(/(\S+)/)) {
      if (!part) continue
      nodes.push(isAtlasUrl(part) ? renderMentionChip(part) : document.createTextNode(part))
    }
  })
  el.replaceChildren(...nodes)
}

// ------------------------------------------------------------------------
// Mention chip insertion. The chip's icon + label are produced by
// renderMentionChip, which parses the URL into a typed target, picks an
// icon, and asynchronously refines the label by fetching the resource.
//
// `appendToEnd` forces the insertion to land at the editor tail even if the
// user's caret was parked mid-draft. The seeded "Open in chat" flow uses
// this so seeds never split an in-progress message.
// ------------------------------------------------------------------------
export function insertMentionIntoEditor(
  el: HTMLDivElement,
  url: string,
  opts?: { appendToEnd?: boolean },
) {
  el.focus()
  const sel = window.getSelection()
  let range: Range

  if (!opts?.appendToEnd && sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0)
    range.deleteContents()
  } else {
    range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
  }
  // Pad with a leading space if the previous character isn't whitespace, so
  // multiple chips don't visually fuse together.
  const before = readEditorText(el)

  if (before && !/\s$/.test(before)) {
    range.insertNode(document.createTextNode(' '))
    range.collapse(false)
  }
  const chip = renderMentionChip(url)

  range.insertNode(chip)
  const trailing = document.createTextNode(' ')

  chip.after(trailing)
  range.setStartAfter(trailing)
  range.setEndAfter(trailing)
  if (sel) {
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

export function insertTextIntoEditor(
  el: HTMLDivElement,
  text: string,
  opts?: { appendToEnd?: boolean },
) {
  el.focus()
  const sel = window.getSelection()
  let range: Range

  if (!opts?.appendToEnd && sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
    range = sel.getRangeAt(0)
    range.deleteContents()
  } else {
    range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
  }
  const before = readEditorText(el)

  if (before && !/\s$/.test(before)) {
    range.insertNode(document.createTextNode(' '))
    range.collapse(false)
  }
  const node = document.createTextNode(text)

  range.insertNode(node)
  range.setStartAfter(node)
  range.setEndAfter(node)
  if (sel) {
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

export async function saveClipboardAttachments(data: DataTransfer): Promise<string[]> {
  // Real local paths (dropped/pasted Finder items) are used AS-IS, like the
  // file/folder picker. Only clipboard bytes with no local path (e.g. a pasted
  // screenshot) are written to a temp file. Routing real paths through
  // savePastedAttachments recursively copied them — instant for a small file,
  // but multi-second for a large dropped folder (e.g. ~/go).
  const directPaths = new Set<string>()
  const files: { name: string; type: string; bytes: ArrayBuffer }[] = []
  const clipboardFiles = Array.from(data.files)
  const itemFiles = Array.from(data.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  const allFiles = [...clipboardFiles, ...itemFiles].filter(
    (file, index, list) =>
      list.findIndex(
        (candidate) => candidate.name === file.name && candidate.size === file.size,
      ) === index,
  )

  for (const file of allFiles) {
    const filePath = api.getPathForFile(file)

    if (filePath) {
      directPaths.add(filePath)
      continue
    }
    files.push({
      name: file.name || `pasted-${String(files.length + 1)}`,
      type: file.type,
      bytes: await file.arrayBuffer(),
    })
  }

  const savedFromBytes =
    files.length > 0 ? await api.savePastedAttachments({ paths: [], files }) : []

  return [...directPaths, ...savedFromBytes]
}

export function handleComposerPasteText(raw: string, insertMention: (url: string) => void) {
  // Insert pasted content piece-by-piece: Nuphos URLs (possibly inline within
  // larger text) become mention chips, everything else stays plain text.
  const parts = raw.split(/(\S+)/) // keep whitespace runs as their own parts

  for (const part of parts) {
    if (!part) continue
    // Peel surrounding punctuation so URLs like "(https://...)," or
    // "https://...," still chipify. The stripped chars get reinserted as
    // plain text around the chip.
    const leading = /^[([{<"'`]*/.exec(part)?.[0] ?? ''
    const m = /^([^)\]}>"'`,.;:!?]+)([)\]}>"'`,.;:!?]*)$/.exec(part.slice(leading.length))

    if (m) {
      const [, core, trailing] = m

      if (isAtlasUrl(core)) {
        if (leading) document.execCommand('insertText', false, leading)
        insertMention(core)
        if (trailing) document.execCommand('insertText', false, trailing)
        continue
      }
    }
    if (isAtlasUrl(part)) {
      insertMention(part.trim())
    } else {
      document.execCommand('insertText', false, part)
    }
  }
}
