// Splitting a string with `[...s]` yields code points, which still tears apart
// emoji ZWJ sequences and combining marks. Segment by grapheme cluster so a
// "character" here is what a reader sees as one.
const segmenter = new Intl.Segmenter()

export function toGraphemes(text: string): string[] {
  return [...segmenter.segment(text)].map((s) => s.segment)
}

export function firstGrapheme(text: string): string {
  for (const s of segmenter.segment(text)) return s.segment

  return ''
}
