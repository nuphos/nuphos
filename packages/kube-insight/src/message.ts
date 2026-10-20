/**
 * A sentence as a translation key and its values. Rules and status never write
 * prose; clients render a Message with `translate` in the reader's language.
 */
export type Message = {
  key: string
  params: Record<string, string>
}

export function message(key: string, params: Record<string, string | number> = {}): Message {
  const out: Record<string, string> = {}

  for (const [name, value] of Object.entries(params)) out[name] = String(value)

  return { key, params: out }
}
