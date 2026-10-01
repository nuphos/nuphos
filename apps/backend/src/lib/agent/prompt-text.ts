/**
 * Strips every code point that can fake a line break or hide as a control
 * sequence inside a '\n'-joined system prompt: C0 controls (< 0x20), DEL and
 * the C1 range (0x7F–0x9F), and the Unicode line separators U+2028/U+2029.
 *
 * The one sanitizer for member-controlled display text landing in prompts
 * (sender names, channel names, credential labels) — the previous per-file
 * copies filtered only `< 0x20`, which let U+2028 + instruction text through.
 * Callers keep their own length caps and extra replacements.
 */
export function stripPromptControlChars(value: string): string {
  return Array.from(value)
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0

      return cp >= 0x20 && (cp < 0x7f || cp > 0x9f) && cp !== 0x2028 && cp !== 0x2029
    })
    .join('')
}
