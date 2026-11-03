import { t } from '../../i18n/index.ts'

export const MIN_RUNTIME_PASSWORD = 32

// The password rides a WebSocket header, which admits only RFC 7230 token characters.
const PASSWORD_CHARACTERS = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]*$/u

/** What is wrong with a runtime admin password, or undefined when nothing is. */
export function runtimePasswordProblem(value: string): string | undefined {
  if (!PASSWORD_CHARACTERS.test(value))
    return t(
      "Only letters, digits and ! # $ % & ' * + - . ^ _ ` | ~ — no spaces, quotes, “/”, “=” or “:”.",
    )
  if (value.length > 0 && value.length < MIN_RUNTIME_PASSWORD)
    return t('{count} of at least {min} characters.', {
      count: value.length,
      min: MIN_RUNTIME_PASSWORD,
    })

  return undefined
}
