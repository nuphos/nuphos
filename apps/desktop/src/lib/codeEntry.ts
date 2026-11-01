/** Sign-in codes are six digits. */
export const CODE_LENGTH = 6

/** What typing, pasting or one-time-code autofill leaves in the field: digits only, at most six. */
export function cleanCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH)
}

// Six digits standing alone, single spaces or hyphens allowed between them: "123 456".
const FULL_CODE = /(?<!\d)\d(?:[ -]?\d){5}(?!\d)/

/** Whether typed text has anything but digits; the field ignores it rather than strip it. */
export function hasNonDigits(text: string): boolean {
  return /\D/.test(text)
}

/**
 * The field after a paste. A full code in the text ("123-456", "Your code: 123456",
 * even beside other numbers) replaces the field; otherwise the pasted digits go in
 * at the selection. caret is where the cursor lands.
 */
export function pasteIntoCode(
  current: string,
  selection: { start: number; end: number },
  text: string,
): { code: string; caret: number } {
  const full = FULL_CODE.exec(text)

  if (full) return { code: cleanCode(full[0]), caret: CODE_LENGTH }
  const digits = cleanCode(text)
  const code = cleanCode(current.slice(0, selection.start) + digits + current.slice(selection.end))

  return { code, caret: Math.min(selection.start + digits.length, code.length) }
}

/** A code submits by itself when an edit makes it complete, not on every later change. */
export function completesCode(previous: string, next: string): boolean {
  return next.length === CODE_LENGTH && next !== previous
}

/**
 * Lets one call run at a time and drops the rest, so a code that submits by itself
 * and an Enter or click right after it send a single request.
 */
export function singleFlight<A extends unknown[]>(
  run: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  let inFlight: Promise<void> | null = null

  return (...args) => {
    inFlight ??= run(...args).finally(() => {
      inFlight = null
    })

    return inFlight
  }
}
