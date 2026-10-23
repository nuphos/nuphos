import { api } from '../../../api'
import { svg } from '../../../lib/atlas-link-mention/icons'
import { isAtlasUrl, renderMentionChip } from '../../../lib/atlasLinkMention'

import { attachmentDragPaths } from './attachmentDrag'
import { isImageAttachmentPath } from './attachments'

// ------------------------------------------------------------------------
// Image references: an "Image #N" chip marks where the Nth attached image
// belongs in the message, and sends as the plain token `[Image #N]`.
// ------------------------------------------------------------------------
const IMAGE_REF = /\[Image #(\d+)\]/

export function imageRefChip(n: number): HTMLElement {
  const chip = document.createElement('span')

  chip.className = 'atlas-mention'
  chip.contentEditable = 'false'
  chip.dataset.imageRef = String(n)
  chip.innerHTML = `${svg('image')}<span class="atlas-mention-label">Image #${String(n)}</span>`

  return chip
}

/** Put an "Image #N" chip at the caret for each image new to `attached`. */
export function insertImageRefs(el: HTMLDivElement, attached: string[], paths: string[]): boolean {
  const images = attached.filter(isImageAttachmentPath)
  const fresh = [...new Set(paths)].filter((p) => isImageAttachmentPath(p) && !images.includes(p))

  fresh.forEach((_, i) => insertChipIntoEditor(el, imageRefChip(images.length + i + 1)))

  return fresh.length > 0
}

/** Drop the chips of a removed image and close the gap in the later numbers. */
export function renumberImageRefs(el: HTMLElement, removed: number) {
  for (const chip of el.querySelectorAll<HTMLElement>('[data-image-ref]')) {
    const n = Number(chip.dataset.imageRef)

    if (n === removed) {
      // Take the space the chip was inserted with, so no gap is left behind.
      const next = chip.nextSibling

      if (next?.nodeType === Node.TEXT_NODE)
        next.textContent = next.textContent?.replace(/^ /, '') ?? ''
      chip.remove()
    } else if (n > removed) chip.replaceWith(imageRefChip(n - 1))
  }
}

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
    if (node.dataset.imageRef) return `[Image #${node.dataset.imageRef}]`
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

/**
 * Rebuild the editor from serialized text, turning Nuphos links back into
 * chips. `[Image #N]` becomes a chip only when the caller restores the same
 * images (a draft); a recalled message has none, so it stays plain text.
 */
/** Focus the editor with the caret after its last character. */
export function focusAtEnd(el: HTMLElement) {
  el.focus({ preventScroll: true })
  const caret = document.createRange()

  caret.selectNodeContents(el)
  caret.collapse(false)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(caret)
}

export function restoreEditorText(el: HTMLDivElement, text: string, images = 0) {
  const nodes: Node[] = []

  text.split('\n').forEach((line, index) => {
    if (index > 0) nodes.push(document.createElement('br'))
    // split() with a capture group puts each reference's N at an odd index.
    line.split(IMAGE_REF).forEach((segment, i) => {
      if (i % 2) {
        const n = Number(segment)

        nodes.push(
          n >= 1 && n <= images ? imageRefChip(n) : document.createTextNode(`[Image #${segment}]`),
        )

        return
      }
      for (const part of segment.split(/(\S+)/)) {
        if (!part) continue
        nodes.push(isAtlasUrl(part) ? renderMentionChip(part) : document.createTextNode(part))
      }
    })
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
  insertChipIntoEditor(el, renderMentionChip(url), opts)
}

export function insertChipIntoEditor(
  el: HTMLDivElement,
  chip: HTMLElement,
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
  // A multi-line block starts on its own line; inline text only needs a space.
  const block = text.includes('\n')

  if (before && !(block ? /\n$/ : /\s$/).test(before)) {
    range.insertNode(document.createTextNode(block ? '\n' : ' '))
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

/**
 * The local paths a drop attaches. An attachment dragged from another chat is
 * already a local file, so its path is used as-is; read synchronously, since
 * the drop's data is gone once the event returns.
 */
export function dropAttachmentPaths(dt: DataTransfer): Promise<string[]> {
  const dragged = attachmentDragPaths(dt)

  return dragged.length > 0 ? Promise.resolve(dragged) : saveClipboardAttachments(dt)
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
