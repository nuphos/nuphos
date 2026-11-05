export type PastePiece = { text: string } | { url: string }

/**
 * A paste split into what the composer inserts: each Nuphos URL on its own
 * (it becomes a mention chip), the text between URLs whole. Every insert
 * fires an input event that re-reads the whole editor, so inserting a long
 * paste a word at a time froze the window.
 */
export function pastePieces(raw: string, isUrl: (text: string) => boolean): PastePiece[] {
  const pieces: PastePiece[] = []
  let text = ''
  const url = (u: string) => {
    if (text) pieces.push({ text })
    text = ''
    pieces.push({ url: u })
  }

  for (const part of raw.split(/(\S+)/)) {
    if (!part) continue
    // Peel surrounding punctuation so URLs like "(https://...)," or
    // "https://...," still chipify. The stripped chars stay plain text.
    const leading = /^[([{<"'`]*/.exec(part)?.[0] ?? ''
    const m = /^([^)\]}>"'`,.;:!?]+)([)\]}>"'`,.;:!?]*)$/.exec(part.slice(leading.length))

    if (m && isUrl(m[1])) {
      text += leading
      url(m[1])
      text += m[2]
    } else if (isUrl(part)) url(part.trim())
    else text += part
  }
  if (text) pieces.push({ text })

  return pieces
}
