export const MIN_RUNTIME_PASSWORD = 32

// The password rides a WebSocket header, which admits only RFC 7230 token characters.
const PASSWORD_CHARACTERS = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]*$/u

/** What is wrong with a runtime admin password, or undefined when nothing is. */
export function runtimePasswordProblem(value: string): string | undefined {
  if (!PASSWORD_CHARACTERS.test(value))
    return "Only letters, digits and ! # $ % & ' * + - . ^ _ ` | ~ — no spaces, quotes, “/”, “=” or “:”."
  if (value.length > 0 && value.length < MIN_RUNTIME_PASSWORD)
    return `${String(value.length)} of at least ${String(MIN_RUNTIME_PASSWORD)} characters.`

  return undefined
}
