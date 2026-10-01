import { firstGrapheme, toGraphemes } from './graphemes.ts'

// CJK, kana, Hangul and full-width forms each take a whole em; Latin capitals
// take about 0.62. One fixed font size therefore can't serve both: it overflows
// a two-ideograph box and leaves an "AB" one half empty. Planes 2-3 are
// wholly CJK extensions, so the range covers rare ideographs like U+20000 too.
const FULL_WIDTH = /[ᄀ-ᇿ⺀-〿ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏！-｠￠-￦\u{20000}-\u{3FFFD}]/u

/** The 1–2 glyphs an avatar shows when a team or user has no uploaded image.
 *  `'?'` for a blank name. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)

  if (words.length === 0) return '?'
  const glyphs =
    words.length === 1
      ? toGraphemes(words[0]!).slice(0, 2)
      : [firstGrapheme(words[0]!), firstGrapheme(words[words.length - 1]!)]
  // An ideograph carries a whole word, and two of them only fit a 20px switcher
  // box at 8px. One glyph at full size reads; two shrunk ones don't.
  const kept = FULL_WIDTH.test(glyphs[0]!) ? [glyphs[0]!] : glyphs

  // Uppercasing can lengthen a glyph (ß → SS); keep one per slot so the width
  // model below and the rendered string stay in agreement.
  return kept.map((glyph) => firstGrapheme(glyph.toUpperCase())).join('')
}

/** The largest font size that keeps `text` inside a `box`-pixel square, summing
 *  each glyph's own advance so mixed scripts aren't sized off a guess. */
export function initialsFontSize(text: string, box: number): number {
  const em = toGraphemes(text).reduce((sum, ch) => sum + (FULL_WIDTH.test(ch) ? 1 : 0.62), 0)

  return Math.floor(Math.min(box * 0.52, (box * 0.84) / em))
}
