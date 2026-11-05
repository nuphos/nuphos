import { t } from '../i18n/index.ts'

// A long paste never goes into the composer as editable text: putting
// hundreds of thousands of characters into a contenteditable freezes the
// window. It becomes a "Pasted text" chip instead, and is sent as a fenced
// block the agent reads in full and the transcript folds back into a chip.

/** A paste at least this long becomes a chip. */
export const PASTE_CHIP_MIN_CHARS = 2_000
/** A paste with at least this many lines becomes a chip. */
export const PASTE_CHIP_MIN_LINES = 30

const INFO = 'pasted-text'
// The fence must be longer than any backtick run inside the text, so its
// closing line can't appear in the text itself.
const BLOCK = /(?:^|\n)(`{3,})pasted-text\n([\s\S]*?)\n\1(?=\n|$)\n?/g

export type PastedTextSegment = { pasted: boolean; text: string }

export function pastesAsChip(text: string): boolean {
  if (text.length >= PASTE_CHIP_MIN_CHARS) return true
  let lines = 1

  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1))
    if (++lines >= PASTE_CHIP_MIN_LINES) return true

  return false
}

export function pastedLineCount(text: string): number {
  let lines = 1

  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines++

  return text.endsWith('\n') ? lines - 1 : lines
}

/** "Pasted text · N lines", the chip's name. */
export function pastedTextLabel(text: string): string {
  const n = pastedLineCount(text)

  return n === 1 ? t('Pasted text · 1 line') : t('Pasted text · {n} lines', { n })
}

/** The block a chip sends, on lines of its own. */
export function encodePastedText(text: string): string {
  let longest = 0

  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  const fence = '`'.repeat(Math.max(3, longest + 1))

  return `\n${fence}${INFO}\n${text}\n${fence}\n`
}

/** Split sent or saved text back into what was typed and what was pasted. */
export function splitPastedText(text: string): PastedTextSegment[] {
  if (!text.includes(INFO)) return [{ pasted: false, text }]
  const out: PastedTextSegment[] = []
  let at = 0

  for (const m of text.matchAll(BLOCK)) {
    if (m.index > at) out.push({ pasted: false, text: text.slice(at, m.index) })
    out.push({ pasted: true, text: m[2] })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ pasted: false, text: text.slice(at) })

  return out
}
