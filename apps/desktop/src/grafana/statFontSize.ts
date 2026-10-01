const MIN_FONT_PX = 14
const MAX_FONT_PX = 56
// Digits in a semibold sans run about 0.6em wide; the panel's inner padding
// is subtracted before fitting.
const GLYPH_EM = 0.6
const PADDING_PX = 24

export function statFontSize(text: string, width: number, height: number): number {
  if (width <= 0 || height <= 0) return MIN_FONT_PX
  const byWidth = (width - PADDING_PX) / (Math.max(1, text.length) * GLYPH_EM)
  const byHeight = height * 0.6

  return Math.max(MIN_FONT_PX, Math.min(MAX_FONT_PX, byWidth, byHeight))
}
