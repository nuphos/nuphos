import { cleanCode, hasNonDigits, pasteIntoCode } from '../lib/codeEntry'

import type { Ref } from 'react'

export const codeInputClasses =
  'w-full px-3 py-2 rounded-md bg-surface border border-line-control text-main text-[14px] ' +
  'outline-none focus:border-line-focus placeholder:text-secondary titlebar-no-drag t-input'

/**
 * A six-digit code field: digits only, a pasted code ("123-456", "Your code:
 * 123456") replaces it, and one-time-code autofill works. Used for sign-in codes
 * and authenticator codes alike.
 */
export function CodeInput({
  value,
  onChange,
  inputRef,
  autoFocus,
}: {
  value: string
  onChange: (next: string) => void
  inputRef?: Ref<HTMLInputElement>
  autoFocus?: boolean
}) {
  return (
    <input
      value={value}
      ref={inputRef}
      autoFocus={autoFocus}
      onChange={(e) => onChange(cleanCode(e.target.value))}
      // Typed letters, spaces and symbols never go in; the cursor stays put.
      onBeforeInput={(e) => {
        if (hasNonDigits(e.data)) e.preventDefault()
      }}
      onPaste={(e) => {
        const input = e.currentTarget
        const pasted = pasteIntoCode(
          value,
          {
            start: input.selectionStart ?? value.length,
            end: input.selectionEnd ?? value.length,
          },
          e.clipboardData.getData('text'),
        )

        e.preventDefault()
        onChange(pasted.code)
        requestAnimationFrame(() => input.setSelectionRange(pasted.caret, pasted.caret))
      }}
      placeholder="000000"
      inputMode="numeric"
      autoComplete="one-time-code"
      className={`${codeInputClasses} text-center text-[18px] tracking-[8px] font-mono`}
    />
  )
}
