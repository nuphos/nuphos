import { parseAtlasError } from '../../../api/errors.ts'

/**
 * What the secure input card can do after a save failed. A runtime that cannot
 * take the value inline refuses it by design — an older Desktop on the agent's
 * computer, which only an update there fixes — so the card names that instead
 * of offering a retry that would fail the same way. Everything else (offline,
 * a stopped runtime, the backend) is worth another attempt.
 */
export type SecretSaveFailure = 'outdated' | 'error'

/** The backend's own code for "this runtime is too old for a secret" (409). */
export function secretSaveFailure(error: unknown): SecretSaveFailure {
  return parseAtlasError(error).code === 'runtime_outdated' ? 'outdated' : 'error'
}

export const SECRET_NAME = /^[A-Za-z]\w{0,63}$/
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/** A site as the backend accepts it: a lowercase host name and, if not the default, a port. */
export function isSiteHost(site: unknown): site is string {
  if (typeof site !== 'string' || site.length > 253) return false
  const host = /^([a-z0-9.-]+)(?::[1-9]\d{0,4})?$/.exec(site)?.[1]
  const labels = host?.split('.') ?? []

  return host === 'localhost' || (labels.length > 1 && labels.every((l) => HOST_LABEL.test(l)))
}

/** One input of a secure card that asks for several: its file name and what the person reads. */
export type SecretField = { name: string; label: string }

/** The card's `fields` and `site`, only when both are what the backend accepts. */
export function parseSecretFields(
  fields: unknown,
  site: unknown,
): { fields: SecretField[]; site: string } | null {
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 6) return null
  if (!isSiteHost(site)) return null
  const parsed = fields.flatMap((field: { name?: unknown; label?: unknown } | null) =>
    typeof field?.name === 'string' &&
    SECRET_NAME.test(field.name) &&
    typeof field.label === 'string' &&
    field.label.trim()
      ? [{ name: field.name, label: field.label.trim() }]
      : [],
  )
  const names = new Set(parsed.map((field) => field.name.toLowerCase()))

  return parsed.length === fields.length && names.size === fields.length
    ? { fields: parsed, site }
    : null
}
